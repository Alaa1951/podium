"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import {
  canAssignRole,
  canChangeOverrides,
  mergeScoped,
} from "@/lib/permissions/grant-policy";
import { parseOverrides } from "@/lib/permissions/resolve";
import { prisma } from "@/lib/prisma";
import { requireAccess } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// ONE PERSON'S ACCESS — the roles they hold and their Grant / Lock exceptions.
//
// All the deciding happens in permissions/grant-policy.ts against rows re-read
// here; nothing the form says about the target or the role is trusted. Every
// change bumps `permissionsUpdatedAt`, which is what the editor sends back to
// prove it was looking at the current state.
// ─────────────────────────────────────────────────────────────────────────────

export type AccessActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; keys?: string[] };

const TARGET_SELECT = {
  id: true,
  email: true,
  role: true,
  studioId: true,
  archivedAt: true,
  permissionOverrides: true,
  permissionsUpdatedAt: true,
} as const;

const roleChangeSchema = z.object({ userId: z.string().min(1), roleId: z.string().min(1) });

async function loadRoleChange(input: unknown) {
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) return null;
  const [target, role] = await Promise.all([
    prisma.user.findUnique({ where: { id: parsed.data.userId }, select: TARGET_SELECT }),
    prisma.accessRole.findUnique({
      where: { id: parsed.data.roleId },
      select: { id: true, name: true, assignableBy: true, permissions: true },
    }),
  ]);
  return target && role && !target.archivedAt ? { target, role } : null;
}

function revalidateAccess() {
  revalidatePath("/users");
  revalidatePath("/studio/people");
  revalidatePath("/(app)", "layout");
}

/** Give a person a role. */
export async function assignAccessRole(input: unknown): Promise<AccessActionResult> {
  const actor = await requireAccess("users.assignRoles");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  const loaded = await loadRoleChange(input);
  if (!loaded) return { ok: false, error: "NOT_FOUND" };
  const { target, role } = loaded;

  const decision = canAssignRole(actor, target, role);
  if (!decision.allowed) return { ok: false, error: decision.reason, keys: decision.keys };

  const existing = await prisma.userAccessRole.findUnique({
    where: { userId_accessRoleId: { userId: target.id, accessRoleId: role.id } },
    select: { id: true },
  });
  if (existing) return { ok: true, message: "Already held." };

  await prisma.$transaction([
    prisma.userAccessRole.create({
      data: { userId: target.id, accessRoleId: role.id, assignedById: actor.id },
    }),
    prisma.user.update({ where: { id: target.id }, data: { permissionsUpdatedAt: new Date() } }),
  ]);

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.accessRoleAssigned,
    targetType: "user",
    targetId: target.id,
    targetLabel: target.email,
    detail: `role "${role.name}" given`,
  });
  revalidateAccess();
  return { ok: true, message: "Role given." };
}

/** Take a role away from a person. */
export async function removeAccessRole(input: unknown): Promise<AccessActionResult> {
  const actor = await requireAccess("users.assignRoles");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  const loaded = await loadRoleChange(input);
  if (!loaded) return { ok: false, error: "NOT_FOUND" };
  const { target, role } = loaded;

  // Taking a role away needs the same authority as giving it.
  const decision = canAssignRole(actor, target, role);
  if (!decision.allowed) return { ok: false, error: decision.reason, keys: decision.keys };

  const removed = await prisma.userAccessRole.deleteMany({
    where: { userId: target.id, accessRoleId: role.id },
  });
  if (removed.count === 0) return { ok: true, message: "Not held." };
  await prisma.user.update({ where: { id: target.id }, data: { permissionsUpdatedAt: new Date() } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.accessRoleRemoved,
    targetType: "user",
    targetId: target.id,
    targetLabel: target.email,
    detail: `role "${role.name}" taken away`,
  });
  revalidateAccess();
  return { ok: true, message: "Role taken away." };
}

const overridesSchema = z.object({
  userId: z.string().min(1),
  grant: z.array(z.string()).max(200),
  deny: z.array(z.string()).max(200),
  /** `permissionsUpdatedAt` as the editor loaded it; "" when it was never set. */
  loadedAt: z.string(),
});

/**
 * Save a person's Grant / Lock exceptions. Only keys the actor may touch
 * change; the rest keep their stored state whatever the client sent.
 */
export async function savePermissionOverrides(input: unknown): Promise<AccessActionResult> {
  const actor = await requireAccess("users.overrides");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = overridesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: TARGET_SELECT,
  });
  if (!target || target.archivedAt) return { ok: false, error: "NOT_FOUND" };
  if ((target.permissionsUpdatedAt?.toISOString() ?? "") !== parsed.data.loadedAt) {
    return { ok: false, error: "STALE" };
  }

  const before = parseOverrides(target.permissionOverrides);
  const editable = (key: string) =>
    actor.role === "admin" || actor.permissions.includes(key);
  const grant = mergeScoped(before.grant, parsed.data.grant, editable);
  // A key cannot be granted and locked at once; the lock wins.
  const deny = mergeScoped(before.deny, parsed.data.deny, editable);
  const after = { grant: grant.filter((key) => !deny.includes(key)), deny };

  const decision = canChangeOverrides(actor, target, before, after);
  if (!decision.allowed) return { ok: false, error: decision.reason, keys: decision.keys };

  const written = await prisma.user.updateMany({
    where: { id: target.id, permissionsUpdatedAt: target.permissionsUpdatedAt },
    data: { permissionOverrides: after, permissionsUpdatedAt: new Date() },
  });
  if (written.count === 0) return { ok: false, error: "STALE" };

  const diff = (a: string[], b: string[]) => b.filter((key) => !a.includes(key));
  await recordAudit({
    actorId: actor.id,
    action: AUDIT.accessOverridesChanged,
    targetType: "user",
    targetId: target.id,
    targetLabel: target.email,
    detail:
      [
        diff(before.grant, after.grant).map((key) => `grant ${key}`).join(", "),
        diff(after.grant, before.grant).map((key) => `ungrant ${key}`).join(", "),
        diff(before.deny, after.deny).map((key) => `lock ${key}`).join(", "),
        diff(after.deny, before.deny).map((key) => `unlock ${key}`).join(", "),
      ]
        .filter(Boolean)
        .join(" · ") || "no change",
  });
  revalidateAccess();
  return { ok: true, message: "Saved." };
}
