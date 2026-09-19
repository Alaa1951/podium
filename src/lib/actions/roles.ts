"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { AUDIT, recordAudit } from "@/lib/audit";
import { normalizeStoredPermissions } from "@/lib/permissions/catalog";
import {
  canEditRole,
  mergeScoped,
  roleRowLock,
  validateRoleContents,
} from "@/lib/permissions/grant-policy";
import { prisma } from "@/lib/prisma";
import { requireAccess } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// ROLES — named, editable bundles of permissions.
//
// Every write re-derives the rules from the database and the catalog:
//   • only keys the actor holds can change (grant-policy.ts), and whatever the
//     actor could not change is carried over as stored, whatever was sent;
//   • a role studios can hand out never carries a BFT-only permission;
//   • a Full-admin-only permission never goes into any role;
//   • a stale save — someone else changed the role since it was loaded — is
//     refused rather than silently overwriting their work.
// ─────────────────────────────────────────────────────────────────────────────

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; keys?: string[] };

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

const ACCOUNT_TYPES = ["admin", "staff", "studio", "competitor", "organiser"] as const;

const fields = {
  name: z.string().trim().min(2).max(60),
  nameAr: z.string().trim().max(60).optional(),
  description: z.string().trim().max(200).optional(),
  assignableBy: z.enum(["bft", "bft_studio"]).default("bft"),
  accountTypes: z.array(z.enum(ACCOUNT_TYPES)).max(ACCOUNT_TYPES.length).optional(),
  permissions: z.array(z.string()).max(200).default([]),
};

const createSchema = z.object(fields);

/** Create a custom role. The key is a slug of the name. */
export async function createAccessRole(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("roles.edit");

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { name, nameAr, description, assignableBy, accountTypes, permissions } = parsed.data;

  const valid = validateRoleContents(permissions, assignableBy);
  if (!valid.allowed) return { ok: false, error: valid.reason, keys: valid.keys };
  const edit = canEditRole(actor, [], permissions);
  if (!edit.allowed) return { ok: false, error: edit.reason, keys: edit.keys };

  const key = slugify(name);
  if (!key) return { ok: false, error: "INVALID_INPUT" };
  const clash = await prisma.accessRole.findUnique({ where: { key }, select: { id: true } });
  if (clash) return { ok: false, error: "KEY_TAKEN" };

  const last = await prisma.accessRole.aggregate({ _max: { sortOrder: true } });
  await prisma.accessRole.create({
    data: {
      key,
      name,
      nameAr: nameAr || null,
      description: description || null,
      assignableBy,
      accountTypes: accountTypes?.length ? accountTypes : undefined,
      permissions,
      sortOrder: (last._max.sortOrder ?? 0) + 10,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.accessRoleChanged,
    targetType: "user",
    targetId: key,
    targetLabel: name,
    detail: `created with ${permissions.length} permission(s)`,
  });

  revalidatePath("/(app)", "layout");
  return { ok: true, message: "Role created." };
}

const updateSchema = z.object({
  roleId: z.string().min(1),
  /** The role's updatedAt as the editor loaded it — the stale-save check. */
  loadedAt: z.string().min(1),
  ...fields,
});

/** Rename a role, change who may hand it out, and set its permissions. */
export async function updateAccessRole(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("roles.edit");

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const data = parsed.data;

  const role = await prisma.accessRole.findUnique({
    where: { id: data.roleId },
    select: { id: true, name: true, permissions: true, updatedAt: true },
  });
  if (!role) return { ok: false, error: "NOT_FOUND" };
  if (role.updatedAt.toISOString() !== data.loadedAt) return { ok: false, error: "STALE" };

  // Whatever this editor could not change keeps its stored state.
  const stored: string[] = normalizeStoredPermissions(role.permissions);
  const next = mergeScoped(
    stored,
    data.permissions,
    (key) => roleRowLock(actor, key, { assignableBy: data.assignableBy }) === null
  );

  const valid = validateRoleContents(next, data.assignableBy);
  if (!valid.allowed) return { ok: false, error: valid.reason, keys: valid.keys };
  const edit = canEditRole(actor, stored, next);
  if (!edit.allowed) return { ok: false, error: edit.reason, keys: edit.keys };

  // The conditional update is the real concurrency guard: two saves racing
  // past the read above cannot both win.
  const written = await prisma.accessRole.updateMany({
    where: { id: role.id, updatedAt: role.updatedAt },
    data: {
      name: data.name,
      nameAr: data.nameAr || null,
      description: data.description || null,
      assignableBy: data.assignableBy,
      accountTypes:
        data.accountTypes === undefined
          ? undefined
          : data.accountTypes.length
            ? data.accountTypes
            : Prisma.DbNull,
      permissions: next,
    },
  });
  if (written.count === 0) return { ok: false, error: "STALE" };

  const added = next.filter((key) => !stored.includes(key));
  const removed = stored.filter((key) => !next.includes(key));
  await recordAudit({
    actorId: actor.id,
    action: AUDIT.accessRoleChanged,
    targetType: "user",
    targetId: role.id,
    targetLabel: data.name,
    detail:
      [added.length && `+${added.join(", +")}`, removed.length && `−${removed.join(", −")}`]
        .filter(Boolean)
        .join(" · ") || "details changed",
  });

  revalidatePath("/(app)", "layout");
  return { ok: true, message: "Role saved." };
}

/** Delete a custom role. System roles, and roles anyone still holds, stay. */
export async function deleteAccessRole(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("roles.edit");

  const parsed = z.object({ roleId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const role = await prisma.accessRole.findUnique({
    where: { id: parsed.data.roleId },
    select: { id: true, name: true, isSystem: true, _count: { select: { users: true } } },
  });
  if (!role) return { ok: false, error: "NOT_FOUND" };
  if (role.isSystem) return { ok: false, error: "SYSTEM_ROLE" };
  if (role._count.users > 0) return { ok: false, error: "ROLE_IN_USE" };

  await prisma.accessRole.delete({ where: { id: role.id } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.accessRoleChanged,
    targetType: "user",
    targetId: role.id,
    targetLabel: role.name,
    detail: "deleted",
  });

  revalidatePath("/(app)", "layout");
  return { ok: true, message: "Role deleted." };
}
