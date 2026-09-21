import type { SeriesScreenProps } from "@/screens/types";
import { notFound } from "next/navigation";

import { ScoreGrid } from "@/components/scores/score-grid";
import type { GridTeam } from "@/components/scores/score-grid-types";
import { getTranslator } from "@/lib/i18n/server";
import { getScopedTeams, getSeriesZones } from "@/lib/queries";
import { getSeriesScoreAudit } from "@/lib/queries-people";
import { requireRole } from "@/lib/session";
import { getStudioSeriesBySlug } from "@/lib/studio-queries";

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
export default async function StudioScoresPage(props: SeriesScreenProps, detailId?: string) {
  const user = await requireRole("studio");
  const { t } = await getTranslator();

  const { series: slug } = await props.params;
  const series = await getStudioSeriesBySlug(user, slug);
  if (!series) notFound();

  const [teams, zones, audit] = await Promise.all([
    getScopedTeams(series.id, user),
    getSeriesZones(series.id),
    getSeriesScoreAudit(series.id, 8, detailId),
  ]);

  // Studios follow their scores here; they do not enter them. Judges do, on
  // their zone and station — a studio person who judges holds the Judge role.
  const frozen = true;
  const frozenReason = t("Scores are entered by the judges on the floor. Ask BFT MENA for any correction.");

  const rows: GridTeam[] = (detailId ? teams.filter(team => team.id === detailId) : teams).map((team) => ({
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
    waitlistedAt: team.waitlistedAt,
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
    waveEnded: false,
  }));

  if (detailId && !teams.some((team) => team.id === detailId)) notFound();

  if (detailId) return <div className="screen"><ScoreGrid teams={rows} zones={zones} editBudget={0} budgetApplies={false} isAdmin={false} frozen={frozen} frozenReason={frozenReason} detailId={detailId} /></div>;

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
        budgetApplies={false}
        editBudget={0}
        isAdmin={false}
        frozen={frozen}
        frozenReason={frozenReason}
      />
    </div>
  );
}
