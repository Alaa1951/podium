import { teamChangesCloseLabel, teamChangeWindow } from "@/lib/ownership";
import { can, canAssistBracketChange } from "@/lib/access";
import { loadBracketFacts } from "@/lib/bracket-data";
import type { SeriesScreenProps } from "@/screens/types";
import { notFound } from "next/navigation";

import { StudioTeamsTable } from "@/components/studio/studio-teams-table";
import { getTranslator } from "@/lib/i18n/server";
import { getScopedRoster } from "@/lib/queries";
import { listStudios } from "@/lib/queries-people";
import { requireRole } from "@/lib/session";
import { getStudioSeriesBySlug } from "@/lib/studio-queries";
import { teamStatus } from "@/lib/team-status";
import { registrationOpen } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/**
 * THE TEAMS TAB.
 *
 * The manual's own columns: number, the two members, category and division,
 * status, and the two things a studio may do — correct the entry, or withdraw
 * it. Both are closed off once registrations close, and the division is BFT
 * MENA's to change at any time.
 */
export default async function StudioTeamsPage(props: SeriesScreenProps, detailId?: string, editMode = false) {
  const user = await requireRole("studio");
  const { t, locale } = await getTranslator();

  const { series: slug } = await props.params;
  const series = await getStudioSeriesBySlug(user, slug);
  if (!series) notFound();

  const [teams, studios] = await Promise.all([getScopedRoster(series.id, user, detailId), listStudios()]);

  // Changing a team's category or level at the athlete's request
  // (registrations.bracket): its own button on each team, open until the
  // competition's own cutoff (Settings → Team changes) — after that it is
  // BFT MENA's, until the team has a score.
  const brackets = !user.viewAs && canAssistBracketChange(user) ? await loadBracketFacts(teams.map((team) => team.id), user, "staff") : {};

  const deadline = registrationOpen({
    role: user.role,
    registrationClosesAt: series.registrationClosesAt,
    now: new Date(),
  });

  const date = (value: Date | null) =>
    value === null
      ? null
      : new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Qatar",
        }).format(value);

  const finalAt = date(series.registrationsFinalAt);
  const closesAt = date(series.registrationClosesAt);

  if (detailId && !teams.some((team) => team.id === detailId)) notFound();

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Teams")}</h1>
          <p>
            {t(
              "The pairs your studio entered in this competition. Correct a name here. When an athlete asks to change category or level, use Category / level on their team; a move into or out of Pro comes from BFT MENA."
            )}
          </p>
        </div>
      </div>

      {finalAt || closesAt ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          {closesAt ? (
            <>
              <strong>{t("Registrations close")}:</strong> {closesAt}.{" "}
            </>
          ) : null}
          {finalAt ? (
            <>
              {t("All registrations in this dashboard are final from")} {finalAt}.
            </>
          ) : null}
        </div>
      ) : null}

      <StudioTeamsTable
        detailId={detailId}
        editMode={editMode}
        rows={teams.map((team) => ({
          id: team.id,
          version: team.membershipVersion,
          closesAt: teamChangesCloseLabel(series.competitionDate, locale),
          closed: !teamChangeWindow(series.competitionDate, new Date(), can(user, "registrations.changeAfterClose")).open,
          number: team.number,
          name: team.name,
          category: team.category,
          division: team.division,
          status: teamStatus(team),
          ...(brackets[team.id] ? { bracket: brackets[team.id] } : {}),
          people: team.competitors.map((person) => ({
            id: person.id,
            fullName: person.fullName,
            phone: person.phone,
            email: person.email,
            dateOfBirth: person.dateOfBirth ? person.dateOfBirth.toISOString().slice(0, 10) : "",
            studioId: person.studioId,
          })),
        }))}
        studios={studios.map((studio) => ({ id: studio.id, name: studio.name }))}
        open={deadline.open && can(user, "registrations.edit") && !user.viewAs}
      />
    </div>
  );
}
