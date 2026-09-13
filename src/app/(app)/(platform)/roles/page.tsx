
import { RolesManager, type RoleDTO } from "@/components/admin/roles-manager";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * ROLES AND WHAT EACH ONE MAY OPEN OR CHANGE.
 *
 * The permission catalog is code (access.ts) — the vocabulary. Roles are data:
 * named bundles of catalog keys, assignable to any account from the Users
 * screen. BFT MENA admins are exempt from permissions entirely and need no
 * role; every other account resolves its assigned list instead of its role's
 * defaults.
 */
export default async function RolesPage() {
  await requirePermission("roles.manage");
  const { t } = await getTranslator();

  const roles = await prisma.accessRole.findMany({
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    select: {
      id: true,
      key: true,
      name: true,
      nameAr: true,
      description: true,
      permissions: true,
      isSystem: true,
      _count: { select: { users: true } },
    },
  });

  const dto: RoleDTO[] = roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    nameAr: role.nameAr,
    description: role.description,
    permissions: (role.permissions as string[]) ?? [],
    isSystem: role.isSystem,
    usersCount: role._count.users,
  }));

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Roles")}</h1>
          <p>
            {t(
              "Name a role, tick the screens and actions it may open and change, then assign it to accounts from the Users screen. Admins always pass every check."
            )}
          </p>
        </div>
      </div>

      <RolesManager roles={dto} />
    </div>
  );
}
