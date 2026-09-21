import type { SeriesScreenProps } from "@/screens/types";
import { notFound } from "next/navigation";
import Link from "next/link";

import { RegistrationEditor } from "@/components/admin/registration-editor";
import { getSeriesStudios } from "@/lib/queries";
import { teamStatus } from "@/lib/team-status";
import { RegisteredFilters } from "@/components/admin/registered-filters";
import { RegisteredTable, type RegisteredRow } from "@/components/admin/registered-table";
import { getTranslator } from "@/lib/i18n/server";
import { getArchivedRoster, getScopedRoster } from "@/lib/queries";
import { can, isBft } from "@/lib/access";
import { getSeriesPaymentDefaults, getSeriesReport, money } from "@/lib/reports";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { normalizeName } from "@/lib/scoring";
import { requireAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * EVERYONE WHO ENTERED THIS COMPETITION.
 *
 * A registration normally arrives already paid, from the registration form and
 * its payment integration — that is the whole point of the pipeline. Taking
 * money by hand exists for the walk-up at the door, and is the exception.
 *
 * Searching by team name OR by a person's name is the same search: the person
 * at the desk is given whichever of the two the competitor happens to say.
 */
export default async function RegistrationsPage(props: SeriesScreenProps, detailId?: string, editMode = false) {
  const user = await requireAccess(editMode ? "registrations.edit" : "registrations.view");
  const searchParams = await props.searchParams;
  const { t } = await getTranslator();

  const { series } = await requireSeries(props.params);
  const needsFullReport = !detailId && isBft(user);
  const [teams, archivedTeams, report, paymentDefaults] = await Promise.all([
    getScopedRoster(series.id, user, detailId),
    !detailId && can(user, "registrations.archive") ? getArchivedRoster(series.id, user) : Promise.resolve([]),
    needsFullReport ? getSeriesReport(series.id) : Promise.resolve(null),
    needsFullReport ? Promise.resolve(null) : getSeriesPaymentDefaults(series.id),
  ]);

  const query = typeof searchParams.q === "string" ? searchParams.q.trim() : "";
  const payment = typeof searchParams.payment === "string" ? searchParams.payment : "all";
  const place = typeof searchParams.place === "string" ? searchParams.place : "all";
  const membership = typeof searchParams.membership === "string" ? searchParams.membership : "all";
  const waveFilter = typeof searchParams.wave === "string" ? searchParams.wave : "all";

  const needle = normalizeName(query);

  const filtered = teams.filter((team) => {
    if (payment !== "all" && team.paymentStatus !== payment) return false;
    // A place, asked separately from the money on purpose.
    if (place === "waiting" && !team.waitlistedAt) return false;
    if (place === "field" && team.waitlistedAt) return false;
    if (membership === "members" && !team.competitors.some((c) => c.studioId)) return false;
    if (membership === "non-members" && team.competitors.every((c) => c.studioId)) return false;
    if (waveFilter === "unassigned" && team.waveId !== null) return false;
    if (waveFilter === "assigned" && team.waveId === null) return false;
    if (!needle) return true;

    return (
      normalizeName(team.name).includes(needle) ||
      String(team.number) === query.trim() ||
      team.competitors.some(
        (person) =>
          normalizeName(person.fullName).includes(needle) ||
          (person.email ?? "").toLowerCase().includes(query.toLowerCase()) ||
          (person.phone ?? "").replace(/\s/g, "").includes(query.replace(/\s/g, ""))
      )
    );
  });

  const rows: RegisteredRow[] = (detailId ? teams.filter((team) => team.id === detailId) : filtered).map((team) => ({
    id: team.id,
    number: team.number,
    name: team.name,
    category: team.category,
    division: team.division,
    wave: team.waveId ? team.wave : null,
    paymentStatus: team.paymentStatus,
    waitlistedAt: team.waitlistedAt,
    amount: team.amountMinor === null ? "—" : (team.amountMinor / 100).toFixed(2),
    currency: team.currency,
    billingNumber: team.billingNumber,
    source: team.source,
    registeredAt: team.registeredAt.toISOString().slice(0, 10),
    attended: team.attendedAt !== null,
    submitted: team.submitted,
    people: team.competitors.map((person) => ({
      id: person.id,
      fullName: person.fullName,
      phone: person.phone,
      email: person.email,
      studioName: person.studioName,
      photoPath: person.photoPath,
    })),
  }));

  const paymentReport = report ?? paymentDefaults!;
  const typicalMinor = paymentReport.paid > 0 ? Math.round(paymentReport.takingsMinor / paymentReport.paid) : 25000;

  const archivedRows: RegisteredRow[] = archivedTeams.map((team) => ({
    id: team.id,
    number: team.number,
    name: team.name,
    category: team.category,
    division: team.division,
    wave: team.waveId ? team.wave : null,
    paymentStatus: team.paymentStatus,
    waitlistedAt: team.waitlistedAt,
    amount: team.amountMinor === null ? "—" : (team.amountMinor / 100).toFixed(2),
    currency: team.currency,
    billingNumber: team.billingNumber,
    source: team.source,
    registeredAt: team.registeredAt.toISOString().slice(0, 10),
    attended: team.attendedAt !== null,
    submitted: team.submitted,
    people: team.competitors.map((person) => ({
      id: person.id,
      fullName: person.fullName,
      phone: person.phone,
      email: person.email,
      studioName: person.studioName,
      photoPath: person.photoPath,
    })),
  }));

  if (detailId && !teams.some((team) => team.id === detailId)) notFound();
  if (detailId && editMode && !user.viewAs) { const team = teams.find(team=>team.id===detailId)!; const studios = await getSeriesStudios(series.id); return <div className="screen"><h1>{t("Edit")} · {team.name}</h1><RegistrationEditor row={{id:team.id,number:team.number,name:team.name,category:team.category,division:team.division,status:teamStatus(team),people:team.competitors.map(person=>({id:person.id,fullName:person.fullName,email:person.email,phone:person.phone,studioId:person.studioId,dateOfBirth:person.dateOfBirth?.toISOString().slice(0,10)??""}))}} studios={studios.map(studio=>({id:studio.id,name:studio.name}))} /></div>; }
  if (detailId) return <div className="screen"><RegisteredTable readOnly={!can(user, "registrations.payment") || !!user.viewAs} rows={rows} seriesId={series.id} canArchive={series.status === "scheduled" && !user.viewAs && can(user, "registrations.archive")} canWaitlist={!user.viewAs && can(user, "registrations.waitlist")} defaultAmount={(typicalMinor / 100).toFixed(2)} defaultCurrency={paymentReport.currency} detailId={detailId} /></div>;

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Competitors")}</h1>
          <p>
            {t(
              "Pairs who entered this competition. They arrive already paid through the registration form; a payment taken at the door is recorded here by hand."
            )}
          </p>
        </div>
        <div className="screen-head-actions">
          <Link href={seriesHref(series.slug, "registrations/new")} className="btn btn-primary">
            {t("Register a pair")}
          </Link>
          <a href={`/api/series/${series.slug}/export`} className="btn btn-secondary">
            {t("Export CSV")}
          </a>
        </div>
      </div>

      {isBft(user) && report ? <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">{t("Registered")}</span>
          <span className="stat-value">{report.registered}</span>
          <span className="stat-note">
            {report.people.total} {t("people")}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t("Paid")}</span>
          <span className="stat-value">{report.paid}</span>
          <span className="stat-note">{money(report.takingsMinor, report.currency)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t("Awaiting payment")}</span>
          <span className="stat-value">{report.pending}</span>
          <span className="stat-note">
            {report.pending > 0 ? t("not on the board") : t("nothing outstanding")}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t("BFT members")}</span>
          <span className="stat-value">{report.people.members}</span>
          <span className="stat-note">
            {report.people.nonMembers} {t("non-members")}
          </span>
        </div>
      </div> : null}

      <RegisteredFilters
        query={query}
        payment={payment}
        place={place}
        membership={membership}
        wave={waveFilter}
        showing={rows.length}
        total={teams.length}
        studios={[]}
      />

      <RegisteredTable
        readOnly={!can(user, "registrations.payment") || !!user.viewAs}
        rows={rows}
        archivedRows={archivedRows}
        seriesId={series.id}
        canArchive={series.status === "scheduled" && !user.viewAs && can(user, "registrations.archive")} canWaitlist={!user.viewAs && can(user, "registrations.waitlist")}
        defaultAmount={(typicalMinor / 100).toFixed(2)}
        defaultCurrency={paymentReport.currency}
      />
    </div>
  );
}
