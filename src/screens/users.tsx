import { notFound } from "next/navigation";

import { AccessPanel } from "@/components/accounts/access-panel";
import { AccountsPanel, type AccountRow } from "@/components/accounts/accounts-panel";
import { can } from "@/lib/access";
import { getTranslator } from "@/lib/i18n/server";
import { buildAccessPanel } from "@/lib/permissions/access-panel";
import { listAccounts, listStudios } from "@/lib/queries";
import { listArchivedAccounts } from "@/lib/queries-people";
import { prisma } from "@/lib/prisma";
import { requireAccess, type CurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Listed = Awaited<ReturnType<typeof listAccounts>>[number];

function toRow(account: Listed): AccountRow {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    status: account.status,
    studioId: account.studio?.id ?? null,
    studioName: account.studio?.name ?? null,
    requestedSeriesId: account.requestedSeriesId ?? null,
    roles: account.accessRoles.map(({ accessRole }) => accessRole),
    lastLoginAt: account.lastLoginAt ? account.lastLoginAt.toISOString().slice(0, 10) : null,
  };
}

/** What the viewer may do on this screen, one flag per permission. */
function abilities(user: CurrentUser) {
  const live = !user.viewAs;
  return {
    canInvite: live && can(user, "users.invite"),
    canEdit: live && can(user, "users.edit"),
    canDisable: live && can(user, "users.disable"),
    canRemove: live && can(user, "users.delete"),
    canViewAs: user.role === "admin" && live,
    canInviteBft: user.role === "admin" || user.role === "staff",
  };
}

/**
 * WHO CAN SIGN IN, AND WHAT EACH OF THEM MAY DO.
 *
 * The list shows every account the viewer may manage with the roles each one
 * holds. A person's own page adds their Access panel: roles as chips, and the
 * full permission tree showing where each permission comes from.
 */
export default async function PeoplePage(detailId?: string, editMode = false, compose = false) {
  const user = await requireAccess(editMode ? "users.edit" : compose ? "users.invite" : "users.view");
  const { t } = await getTranslator();

  const [accounts, archived, studios] = await Promise.all([
    listAccounts(user),
    listArchivedAccounts(user),
    listStudios(),
  ]);

  const rows = accounts.map(toRow);
  // Which competition an athlete signed up for is set here for anybody who
  // signed up before the form asked, and whenever somebody moves.
  const competitions = (
    await prisma.series.findMany({
      where: { status: { in: ["scheduled", "live"] }, archivedAt: null, isActive: true },
      orderBy: { competitionDate: "asc" },
      select: { id: true, name: true },
    })
  );
  const archivedRows = archived.map(toRow);
  const flags = abilities(user);
  const studioOptions = studios.map((studio) => ({ id: studio.id, name: studio.name }));
  const invited = rows.filter((row) => row.status === "invited").length;

  if (detailId) {
    if (!rows.some((account) => account.id === detailId)) notFound();
    const access = editMode ? null : await buildAccessPanel(user, detailId);
    return (
      <div className="screen">
        <AccountsPanel
          accounts={rows}
          competitions={competitions}
          studios={studioOptions}
          ownStudioName={null}
          ownUserId={user.id}
          detailId={detailId}
          editMode={editMode}
          {...flags}
        />
        {access ? <AccessPanel key={access.loadedAt} data={access} /> : null}
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Users")}</h1>
          <p>
            {t(
              "Everyone who can sign in, with the roles they hold. Open a person to see exactly what they can do, and to give or take away roles."
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
          <span className="stat-value">
            {rows.filter((r) => r.role === "admin" || r.role === "staff").length}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t("Organisers")}</span>
          <span className="stat-value">{rows.filter((r) => r.role === "organiser").length}</span>
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
        accounts={rows}
          competitions={competitions}
        studios={studioOptions}
        ownStudioName={null}
        archivedAccounts={archivedRows}
        ownUserId={user.id}
        {...flags}
      />
    </div>
  );
}
