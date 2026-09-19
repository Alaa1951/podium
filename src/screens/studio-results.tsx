import type { SeriesScreenProps } from "@/screens/types";
import { notFound } from "next/navigation";

import { ScoreGrid } from "@/components/scores/score-grid";
import type { GridTeam } from "@/components/scores/score-grid-types";
import { getTranslator } from "@/lib/i18n/server";
import { getScopedTeams, getSeriesTeams, getSeriesZones } from "@/lib/queries";
import { getSeriesScoreAudit } from "@/lib/queries-people";
import { requireRole } from "@/lib/session";
import { getStudioSeriesBySlug } from "@/lib/studio-queries";

export const dynamic = "force-dynamic";

/**
 * THE RESULTS TAB.
 *
 * The score sheet, holding only this studio's own teams, read-only: scores
 * are entered by the judges on the floor, and a studio person who judges
 * holds the Judge role and scores from their own sheet.
 */
export default async function StudioResultsPage(props: SeriesScreenProps, detailId?: string) {
  const user = await requireRole("studio");
  const { t } = await getTranslator();

  const { series: slug } = await props.params;
  const series = await getStudioSeriesBySlug(user, slug);
  if (!series) notFound();

  const [mine, everyone, zones, audit] = await Promise.all([
    getScopedTeams(series.id, user),
    // The whole field, for the placing shown beside each of the studio's rows.
    // A rank worked out from one studio's teams alone would be a different and
    // wrong number.
    getSeriesTeams(series.id),
    getSeriesZones(series.id),
    // A studio sees the history of its OWN scores — who entered them and what
    // BFT MENA corrected — and only ever reads it for its own teams below.
    getSeriesScoreAudit(series.id, 8, detailId),
  ]);

  // A studio reads its results; the judges on the floor enter them.
  const frozen = true;
  const frozenReason = t("Scores are entered by the judges on the floor. Yours appear here as they are recorded.");

  const teams: GridTeam[] = (detailId ? mine.filter(team => team.id === detailId) : mine).map((team) => ({
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
    peerTotals: everyone
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

  if (detailId) return <div className="screen"><ScoreGrid teams={teams} zones={zones} editBudget={0} budgetApplies={false} isAdmin={false} frozen={frozen} frozenReason={frozenReason} detailId={detailId} /></div>;

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Results")}</h1>
          <p>
            {t(
              "Your teams' scores. A saved score is final — any correction after that comes from BFT MENA."
            )}
          </p>
        </div>
      </div>

      <ScoreGrid
        teams={teams}
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
