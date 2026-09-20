import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessPanel } from "@/components/accounts/access-panel";
import { AccountsPanel, type AccountRow } from "@/components/accounts/accounts-panel";
import { PlainHeader } from "@/components/app/plain-header";
import { ApprovalsSection } from "@/components/approvals/approvals-section";
import { PairingPanel, type PairableAthlete } from "@/components/approvals/pairing-panel";
import { can } from "@/lib/access";
import { getTranslator } from "@/lib/i18n/server";
import { buildAccessPanel } from "@/lib/permissions/access-panel";
import { prisma } from "@/lib/prisma";
import { listAccounts } from "@/lib/queries";
import { requireAccess, requireRole, type CurrentUser } from "@/lib/session";
import { getStudioSeries } from "@/lib/studio-queries";
import { registrationOpen } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/**
 * A STUDIO'S OWN PEOPLE.
 *
 * Everyone signed in under this studio — its athletes, organisers and judges —
 * with the roles each holds. A studio gives only the roles BFT MENA marked as
 * "studios can give" (Athlete, Organiser, Judge), only to its own people, and
 * never to itself; the Access panel offers exactly those, and the server
 * re-checks every one (permissions/grant-policy.ts).
 */
/** The studio's approved athletes and the competitions open to enter them in. */
async function pairingData(user: CurrentUser) {
  const [rows, series] = await Promise.all([
    prisma.user.findMany({
      where: {
        studioId: user.studioId ?? "__none__",
        role: "competitor",
        approvalStatus: "approved",
        archivedAt: null,
        status: { not: "disabled" },
      },
      orderBy: { name: "asc" },
      take: 500,
      select: {
        id: true,
        name: true,
        email: true,
        athleteProfile: {
          select: { division: true, category: true, sex: true, lookingForPartner: true, partnerUserId: true },
        },
      },
    }),
    getStudioSeries(user),
  ]);
  const now = new Date();
  const athletes: PairableAthlete[] = rows.map((row) => ({
    id: row.id,
    // The panel renders a name and a bracket. The address was being shipped
    // to five hundred browser rows for nothing, so it stays on the server.
    name: row.name ?? row.email,
    division: row.athleteProfile?.division ?? null,
    category: row.athleteProfile?.category ?? null,
    sex: row.athleteProfile?.sex ?? null,
    lookingForPartner: row.athleteProfile?.lookingForPartner ?? false,
    partnerId: row.athleteProfile?.partnerUserId ?? null,
  }));
  const competitions = series
    .filter((one) => one.status !== "final" && registrationOpen({ role: user.role, registrationClosesAt: one.registrationClosesAt, now }).open)
    .map((one) => ({ id: one.id, name: one.name }));
  return { athletes, competitions };
}

export default async function StudioPeoplePage(detailId?: string, compose = false) {
  await requireRole("studio");
  const user = await requireAccess(compose ? "users.invite" : "users.view");
  const { t } = await getTranslator();

  const [accounts, studio] = await Promise.all([
    listAccounts(user),
    user.studioId
      ? prisma.studio.findUnique({ where: { id: user.studioId }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  const rows: AccountRow[] = accounts.map((account) => ({
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    status: account.status,
    studioId: account.studio?.id ?? null,
    studioName: account.studio?.name ?? null,
    roles: account.accessRoles.map(({ accessRole }) => accessRole),
    lastLoginAt: account.lastLoginAt ? account.lastLoginAt.toISOString().slice(0, 10) : null,
  }));

  const live = !user.viewAs;
  const flags = {
    canInvite: live && can(user, "users.invite"),
    canDisable: live && can(user, "users.disable"),
    canRemove: live && can(user, "users.delete"),
  };

  if (detailId && !rows.some((row) => row.id === detailId)) notFound();
  const access = detailId ? await buildAccessPanel(user, detailId) : null;
  const pairing = !detailId && !compose && !user.viewAs && can(user, "registrations.pair") ? await pairingData(user) : null;

  return (
    <div className="screen">
      <PlainHeader roleLabel={user.name ?? t("Studio")} homeHref="/studio" />
      {!detailId ? (
        <div className="screen-head">
          <div>
            <h1>{t("People")}</h1>
            <p>
              {t(
                "Everyone in {studio}. Open a person to give them the Athlete, Organiser or Judge role, or to take one away.",
                { studio: studio?.name ?? t("your studio") }
              )}
            </p>
          </div>
          <Link href="/studio" className="btn btn-secondary desktop-only">
            {t("Back")}
          </Link>
        </div>
      ) : null}

      {!detailId && !compose && can(user, "approvals.view") ? (
        <section style={{ marginBottom: 24 }}>
          <h2 className="section-title">{t("Requests to join")}</h2>
          <ApprovalsSection user={user} />
        </section>
      ) : null}

      {pairing ? (
        <section style={{ marginBottom: 24 }}>
          <h2 className="section-title">{t("Pair athletes into a team")}</h2>
          <PairingPanel athletes={pairing.athletes} competitions={pairing.competitions} />
        </section>
      ) : null}

      <AccountsPanel
        accounts={rows}
        studios={[]}
        ownStudioName={studio?.name ?? null}
        ownUserId={user.id}
        detailId={detailId}
        compose={compose}
        basePath="/studio/people"
        {...flags}
      />
      {access ? <AccessPanel key={access.loadedAt} data={access} /> : null}
    </div>
  );
}
