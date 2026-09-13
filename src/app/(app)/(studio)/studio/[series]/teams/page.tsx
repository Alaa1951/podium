import { notFound } from "next/navigation";

import { StudioTeamsTable } from "@/components/studio/studio-teams-table";
import { getTranslator } from "@/lib/i18n/server";
import { getScopedTeams } from "@/lib/queries";
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
export default async function StudioTeamsPage(props: PageProps<"/studio/[series]/teams">) {
  const user = await requireRole("studio");
  const { t, locale } = await getTranslator();

  const { series: slug } = await props.params;
  const series = await getStudioSeriesBySlug(user, slug);
  if (!series) notFound();

  const [teams, studios] = await Promise.all([getScopedTeams(series.id, user), listStudios()]);

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

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Teams")}</h1>
          <p>
            {t(
              "The pairs your studio entered in this competition. Correct a name or a category here; a change of division comes from BFT MENA."
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
        rows={teams.map((team) => ({
          id: team.id,
          number: team.number,
          name: team.name,
          category: team.category,
          division: team.division,
          status: teamStatus(team),
          people: team.competitors.map((person) => ({
            fullName: person.fullName,
            phone: person.phone,
            email: person.email,
            dateOfBirth: person.dateOfBirth ? person.dateOfBirth.toISOString().slice(0, 10) : "",
            studioId: person.studioId,
          })),
        }))}
        studios={studios.map((studio) => ({ id: studio.id, name: studio.name }))}
        open={deadline.open}
      />
    </div>
  );
}
