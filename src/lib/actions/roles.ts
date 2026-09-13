"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ALL_PERMISSION_KEYS, } from "@/lib/access";
import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// ACCESS ROLES — named bundles of permission keys.
//
// A role is assigned to accounts (Users screen); the account then resolves
// exactly that bundle instead of its role defaults. Keys are stable slugs so
// seeds and code can rely on them; permissions must all exist in the catalog
// (PERMISSION_GROUPS) — the roles screen only offers catalog keys.
// ─────────────────────────────────────────────────────────────────────────────

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

const nameSchema = z.object({
  name: z.string().trim().min(2).max(60),
  nameAr: z.string().trim().max(60).optional(),
  description: z.string().trim().max(200).optional(),
});

const permissionsSchema = z
  .object({ permissions: z.array(z.string()) })
  .refine(
    (data) => data.permissions.every((key) => ALL_PERMISSION_KEYS.includes(key)),
    { message: "UNKNOWN_PERMISSION" }
  );

const createSchema = nameSchema.and(
  z.object({ permissions: permissionsSchema.shape.permissions.default([]) })
);

/** Create a custom access role. The key is a slug of the name. */
export async function createAccessRole(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { name, nameAr, description, permissions } = parsed.data;

  const key = slugify(name);
  if (!key) return { ok: false, error: "INVALID_INPUT" };

  const clash = await prisma.accessRole.findUnique({ where: { key }, select: { id: true } });
  if (clash) return { ok: false, error: "KEY_TAKEN" };

  await prisma.accessRole.create({
    data: { key, name, nameAr: nameAr ?? null, description: description ?? null, permissions },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.accessRoleChanged,
    targetType: "user",
    targetId: key,
    targetLabel: name,
    detail: `created with ${permissions.length} permission(s)`,
  });

  revalidatePath("/roles", "layout");
  return { ok: true, message: "Role created." };
}

const updateSchema = z.object({
  roleId: z.string().min(1),
  name: nameSchema.shape.name,
  nameAr: nameSchema.shape.nameAr,
  description: nameSchema.shape.description,
  permissions: z.array(z.string()).refine(
    (keys) => keys.every((key) => ALL_PERMISSION_KEYS.includes(key)),
    { message: "UNKNOWN_PERMISSION" }
  ),
});

/** Rename a role and set its permission list wholesale. */
export async function updateAccessRole(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const role = await prisma.accessRole.findUnique({
    where: { id: parsed.data.roleId },
    select: { id: true, key: true, name: true, permissions: true },
  });
  if (!role) return { ok: false, error: "NOT_FOUND" };

  const before = (role.permissions as string[]) ?? [];
  const after = parsed.data.permissions;

  await prisma.accessRole.update({
    where: { id: role.id },
    data: {
      name: parsed.data.name,
      nameAr: parsed.data.nameAr ?? null,
      description: parsed.data.description ?? null,
      permissions: after,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.accessRoleChanged,
    targetType: "user",
    targetId: role.id,
    targetLabel: parsed.data.name,
    detail: `${before.length} → ${after.length} permission(s)`,
  });

  revalidatePath("/roles", "layout");
  return { ok: true, message: "Role saved." };
}

/** Delete a custom role. System roles cannot be deleted; assigned accounts
 *  fall back to their role's own defaults. */
export async function deleteAccessRole(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = z.object({ roleId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const role = await prisma.accessRole.findUnique({
    where: { id: parsed.data.roleId },
    select: { id: true, key: true, name: true, isSystem: true, _count: { select: { users: true } } },
  });
  if (!role) return { ok: false, error: "NOT_FOUND" };
  if (role.isSystem) return { ok: false, error: "SYSTEM_ROLE" };

  await prisma.accessRole.delete({ where: { id: role.id } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.accessRoleChanged,
    targetType: "user",
    targetId: role.id,
    targetLabel: role.name,
    detail: `deleted (${role._count.users} account(s) fell back to role defaults)`,
  });

  revalidatePath("/roles", "layout");
  return { ok: true, message: "Role deleted." };
}
