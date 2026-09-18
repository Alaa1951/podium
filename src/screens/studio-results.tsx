import { can } from "@/lib/access";
import type { SeriesScreenProps } from "@/screens/types";
import { notFound } from "next/navigation";

import { ScoreGrid } from "@/components/scores/score-grid";
import type { GridTeam } from "@/components/scores/score-grid-types";
import { getTranslator } from "@/lib/i18n/server";
import { getScopedTeams, getSeriesTeams, getSeriesZones } from "@/lib/queries";
import { getSeriesScoreAudit } from "@/lib/queries-people";
import { scoreWriteBudget, requireRole } from "@/lib/session";
import { getStudioSeriesBySlug } from "@/lib/studio-queries";
import { scoreEntryOpen } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/**
 * THE RESULTS TAB.
 *
 * The manual's score sheet, holding only this studio's own teams. Whether a
 * studio may write here at all is the series' own setting — with it off, the
 * sheet still shows what BFT MENA has recorded, because a studio being unable
 * to enter a score is not a reason to hide the score from it.
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

  const deadline = scoreEntryOpen({
    role: user.role,
    scoreEntryClosesAt: series.scoreEntryClosesAt,
    now: new Date(),
  });

  const frozen = !!user.viewAs || !can(user,"scores.edit") || !series.studiosMayEnterScores || !deadline.open;
  const frozenReason = !series.studiosMayEnterScores
    ? t("BFT MENA is entering scores for this competition. Yours appear here as they are recorded.")
    : !deadline.open
      ? t("Score entry has closed for this competition.")
      : undefined;

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

  if (detailId) return <div className="screen"><ScoreGrid teams={teams} zones={zones} editBudget={scoreWriteBudget(series)} budgetApplies={user.role === "studio"} isAdmin={user.role === "admin"} frozen={frozen} frozenReason={frozenReason} detailId={detailId} /></div>;

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
        budgetApplies={user.role === "studio"}
        editBudget={scoreWriteBudget(series)}
        isAdmin={false}
        frozen={frozen}
        frozenReason={frozenReason}
      />
    </div>
  );
}
