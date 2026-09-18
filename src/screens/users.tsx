import { can } from "@/lib/access";
import { notFound } from "next/navigation";
import { AccountsPanel, type AccountRow } from "@/components/accounts/accounts-panel";
import { getTranslator } from "@/lib/i18n/server";
import { listAccounts, listStudios } from "@/lib/queries";
import { listArchivedAccounts } from "@/lib/queries-people";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * WHO CAN SIGN IN.
 *
 * BFT MENA staff, and studio staff. Competitors are data rather than accounts:
 * a pair registers and competes without ever having a password, which is why
 * this list is short and the registrations list is long.
 */
export default async function PeoplePage(detailId?: string, editMode = false, compose = false) {
  const user = await requirePermission(editMode || compose ? "users.manage" : "users.view");
  const { t } = await getTranslator();

  const [accounts, archived, studios, accessRoles] = await Promise.all([
    listAccounts(user),
    listArchivedAccounts(user),
    listStudios(),
    prisma.accessRole.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const rows: AccountRow[] = accounts.map((account) => ({
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    status: account.status,
    studioId: account.studio?.id ?? null,
    studioName: account.studio?.name ?? null,
    accessRoleId: account.accessRoleId ?? null,
    lastLoginAt: account.lastLoginAt ? account.lastLoginAt.toISOString().slice(0, 10) : null,
  }));

  const archivedRows: AccountRow[] = archived.map((account) => ({
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    status: account.status,
    studioId: account.studio?.id ?? null,
    studioName: account.studio?.name ?? null,
    accessRoleId: account.accessRoleId ?? null,
    lastLoginAt: account.lastLoginAt ? account.lastLoginAt.toISOString().slice(0, 10) : null,
  }));

  const invited = rows.filter((row) => row.status === "invited").length;

  if (detailId && !rows.some((account) => account.id === detailId)) notFound();
  if (detailId) return <div className="screen"><AccountsPanel accounts={rows} studios={studios.map((studio) => ({id:studio.id,name:studio.name}))} readOnly={!can(user,"users.manage") || !!user.viewAs} isAdmin={user.role === "admin" && !user.viewAs} ownStudioName={null} accessRoles={accessRoles} ownUserId={user.id} canViewAs={user.role === "admin" && !user.viewAs} detailId={detailId} editMode={editMode} /></div>;

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Users")}</h1>
          <p>
            {t(
              "Accounts that can sign in. No account is ever self-created: BFT MENA invites studios, and a studio invites its own staff."
            )}
          </p>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <span className="stat-label">{t("Accounts")}</span>
          <span className="stat-value">{rows.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t("BFT MENA")}</span>
          <span className="stat-value">{rows.filter((r) => r.role === "admin").length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t("Studio staff")}</span>
          <span className="stat-value">{rows.filter((r) => r.role === "studio").length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t("Awaiting first sign-in")}</span>
          <span className="stat-value">{invited}</span>
          <span className="stat-note">
            {invited > 0 ? t("invitations not yet used") : t("everyone is set up")}
          </span>
        </div>
      </div>

      <AccountsPanel
        compose={compose}
        readOnly={!can(user,"users.manage") || !!user.viewAs}
        accounts={rows}
        studios={studios.map((studio) => ({ id: studio.id, name: studio.name }))}
        isAdmin={user.role === "admin" && can(user,"users.manage") && !user.viewAs}
        ownStudioName={null}
        accessRoles={accessRoles}
        archivedAccounts={archivedRows}
        ownUserId={user.id}
        canViewAs={user.role === "admin" && !user.viewAs}
      />
    </div>
  );
}
