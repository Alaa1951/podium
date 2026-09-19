import { notFound } from "next/navigation";

import { RolesManager, type RoleDTO, type RoleTreeModule } from "@/components/admin/roles-manager";
import { can } from "@/lib/access";
import { getTranslator } from "@/lib/i18n/server";
import { normalizeStoredPermissions, PERMISSION_TREE } from "@/lib/permissions/catalog";
import { ensureSystemRoles } from "@/lib/permissions/ensure-system-roles";
import { prisma } from "@/lib/prisma";
import { requireAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * ROLES AND WHAT EACH ONE MAY OPEN OR CHANGE.
 *
 * The permission catalog is code (permissions/catalog.ts) — the vocabulary.
 * Roles are data: named bundles of catalog keys, edited here and given to
 * people from their Access panel. A person can hold several; their
 * permissions add up. BFT MENA Full access passes every check and needs none.
 */
export default async function RolesPage(detailId?: string, editMode = false) {
  const viewer = await requireAccess(editMode ? "roles.edit" : "roles.view");
  const { t } = await getTranslator();

  // A fresh database (or one upgraded from the single-role system) gets the
  // roles Podium ships with before anybody looks for them.
  await ensureSystemRoles();

  const roles = await prisma.accessRole.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      key: true,
      name: true,
      nameAr: true,
      description: true,
      permissions: true,
      isSystem: true,
      assignableBy: true,
      accountTypes: true,
      updatedAt: true,
      _count: { select: { users: true } },
    },
  });

  const dto: RoleDTO[] = roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    nameAr: role.nameAr,
    description: role.description,
    permissions: normalizeStoredPermissions(role.permissions),
    isSystem: role.isSystem,
    assignableBy: role.assignableBy,
    accountTypes: Array.isArray(role.accountTypes) ? (role.accountTypes as string[]) : [],
    usersCount: role._count.users,
    loadedAt: role.updatedAt.toISOString(),
  }));

  // The tree, with what the viewer holds marked: a row they do not hold is
  // shown locked with the reason, never as a silent grey checkbox.
  const holds = (key: string) => viewer.role === "admin" || viewer.permissions.includes(key);
  const tree: RoleTreeModule[] = PERMISSION_TREE.map((module) => ({
    key: module.key,
    label: module.label,
    labelAr: module.labelAr,
    screens: module.screens.map((screen) => ({
      key: screen.key,
      label: screen.label,
      labelAr: screen.labelAr,
      rows: screen.permissions.map((entry) => ({
        key: entry.key,
        label: entry.label,
        labelAr: entry.labelAr,
        policy: entry.policy,
        held: holds(entry.key),
      })),
    })),
  }));

  if (detailId && !dto.some((item) => item.id === detailId)) notFound();
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Roles")}</h1>
          <p>
            {t(
              "Each role is a set of screens and actions. Tick what a role may open and do, then give it to people from their Access panel. A person can hold several roles, and their access adds up."
            )}
          </p>
        </div>
      </div>

      <RolesManager
        roles={dto}
        tree={tree}
        canEdit={can(viewer, "roles.edit") && !viewer.viewAs}
        detailId={detailId}
        editMode={editMode}
      />
    </div>
  );
}
