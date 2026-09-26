import "server-only";

import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { parseOverrides, resolveEffectivePermissions, type AccessInputs, type HeldRole } from "@/lib/permissions/resolve";
import { DEFAULT_ROLE_FOR, systemRole } from "@/lib/permissions/system-roles";

/**
 * The roles in force for an account: the ones it holds, or — while it holds
 * none — its account type's default role. The stored row wins over the code
 * definition, because BFT MENA edits the stored row.
 */
async function defaultRole(accountType: Role): Promise<HeldRole[]> {
  const key = DEFAULT_ROLE_FOR[accountType];
  if (!key) return [];
  const row = await prisma.accessRole.findUnique({
    where: { key },
    select: { key: true, name: true, permissions: true },
  });
  if (row) return [row];
  const def = systemRole(key);
  return def ? [{ key: def.key, name: def.name, permissions: def.permissions }] : [];
}

/** Everything the resolver needs about one account, read fresh. */
export async function loadAccessInputs(userId: string, accountType: Role): Promise<AccessInputs> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      approvalStatus: true,
      permissionOverrides: true,
      accessRoles: {
        select: { accessRole: { select: { key: true, name: true, permissions: true } } },
        orderBy: { accessRole: { sortOrder: "asc" } },
      },
    },
  });
  const held = row?.accessRoles.map((link) => link.accessRole) ?? [];
  return {
    accountType,
    // A sign-up waiting for approval (or turned down) sees the general pages
    // only, whatever roles it may already carry.
    approved: (row?.approvalStatus ?? "approved") === "approved",
    roles: held.length ? held : await defaultRole(accountType),
    overrides: parseOverrides(row?.permissionOverrides),
  };
}

/** The effective permission list for one account. */
export async function loadPermissions(userId: string, accountType: Role): Promise<string[]> {
  if (accountType === "admin") return ["*"];
  return resolveEffectivePermissions(await loadAccessInputs(userId, accountType));
}

/**
 * A target account as canManageTarget (grant-policy.ts) needs it: a BFT MENA
 * Partial target carries its effective permissions, so a Partial actor can be
 * held to "only manage what you hold". Other targets pass through unchanged.
 */
export async function targetWithPermissions<T extends { id: string; role: Role }>(
  target: T
): Promise<T & { permissions?: string[] }> {
  if (target.role !== "staff") return target;
  return { ...target, permissions: await loadPermissions(target.id, target.role) };
}
