import { notFound } from "next/navigation";

import { ScoreGrid } from "@/components/scores/score-grid";
import type { GridTeam } from "@/components/scores/score-grid-types";
import { getTranslator } from "@/lib/i18n/server";
import { getScopedTeams, getSeriesZones } from "@/lib/queries";
import { getSeriesScoreAudit } from "@/lib/queries-people";
import { scoreWriteBudget, requireRole } from "@/lib/session";
import { getStudioSeriesBySlug } from "@/lib/studio-queries";
import { scoreEntryOpen } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/**
 * THE STUDIO'S OWN SCORE SHEET.
 *
 * The same one-sheet score entry BFT MENA runs, narrowed to this studio's own
 * pairs. Whether a row can be written at all is the series' own setting —
 * `studiosMayEnterScores`, the deadline, and the correction budget — and the
 * server re-checks every one of those on every save, whatever this screen
 * shows.
 */
export default async function StudioScoresPage(props: PageProps<"/studio/[series]/scores">) {
  const user = await requireRole("studio");
  const { t } = await getTranslator();

  const { series: slug } = await props.params;
  const series = await getStudioSeriesBySlug(user, slug);
  if (!series) notFound();

  const [teams, zones, audit] = await Promise.all([
    getScopedTeams(series.id, user),
    getSeriesZones(series.id),
    getSeriesScoreAudit(series.id),
  ]);

  const deadline = scoreEntryOpen({
    role: "studio",
    scoreEntryClosesAt: series.scoreEntryClosesAt,
    now: new Date(),
  });
  const frozen = !series.studiosMayEnterScores || !deadline.open;
  const frozenReason = !series.studiosMayEnterScores
    ? t("BFT MENA has not opened score entry for studios in this competition.")
    : !deadline.open
      ? t("Score entry has closed. Ask BFT MENA for any correction.")
      : undefined;

  const rows: GridTeam[] = teams.map((team) => ({
    id: team.id,
    number: team.number,
    name: team.name,
    category: team.category,
    division: team.division,
    wave: team.wave,
    competitors: team.competitors.map((person) => person.fullName),
    submitted: team.submitted,
    scoreEdits: team.scoreEdits,
    paymentStatus: team.paymentStatus,
    values: team.values,
    peerTotals: teams
      .filter(
        (other) =>
          other.id !== team.id &&
          other.submitted &&
          other.category === team.category &&
          other.division === team.division
      )
      .map((other) => other.total),
    audit: audit.get(team.id) ?? [],
    waveEndsAt: null,
  }));

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Score entry")}</h1>
          <p>
            {t("Your own pairs on one sheet, the way the judge's sheets read.")}
          </p>
        </div>
      </div>

      <ScoreGrid
        teams={rows}
        zones={zones}
        editBudget={scoreWriteBudget(series)}
        isAdmin={false}
        frozen={frozen}
        frozenReason={frozenReason}
      />
    </div>
  );
}
