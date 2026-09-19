import "server-only";

import { prisma } from "@/lib/prisma";
import { SYSTEM_ROLES } from "@/lib/permissions/system-roles";

/**
 * Create any shipped role that is missing. Never overwrites an existing row:
 * once a system role exists it belongs to BFT MENA, who edit it on the Roles
 * screen. Idempotent and cheap — one read, and writes only for gaps.
 */
export async function ensureSystemRoles(): Promise<void> {
  const existing = await prisma.accessRole.findMany({
    where: { key: { in: SYSTEM_ROLES.map((role) => role.key) } },
    select: { key: true },
  });
  const have = new Set(existing.map((row) => row.key));
  for (const role of SYSTEM_ROLES) {
    if (have.has(role.key)) continue;
    await prisma.accessRole
      .create({
        data: {
          key: role.key,
          name: role.name,
          nameAr: role.nameAr,
          description: role.description,
          permissions: role.permissions,
          isSystem: true,
          assignableBy: role.assignableBy,
          accountTypes: role.accountTypes,
          sortOrder: role.sortOrder,
        },
      })
      // Two requests racing to create the same row: the loser is fine.
      .catch(() => undefined);
  }
}
