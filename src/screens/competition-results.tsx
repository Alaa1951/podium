import type { SeriesScreenProps } from "@/screens/types";
import { notFound } from "next/navigation";
import { ResultsTable, type PodiumBlock, type ResultRow } from "@/components/series/results-table";
import { PublishToggle } from "@/components/admin/publish-toggle";
import { getTranslator } from "@/lib/i18n/server";
import { getSeriesTeams, getSeriesZones, podiums, rankBracket } from "@/lib/queries";
import { requireSeries } from "@/lib/require-series";
import { bracketLabel } from "@/lib/scoring";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * THE RESULTS OF THIS COMPETITION.
 *
 * The podium of every bracket, then the whole field in order. Written for the
 * people running the competition, who already know who they are — a "find your
 * result" wizard belongs on the competitor's screen, not here.
 *
 * Ranks are computed inside a bracket, never across brackets: the loads differ
 * by category and division, so totals are only comparable within one.
 */
export default async function ResultsPage(props: SeriesScreenProps, detailId?: string) {
  await requirePermission("results.view");
  const { t } = await getTranslator();

  const { series } = await requireSeries(props.params);
  const [teams, zones] = await Promise.all([
    getSeriesTeams(series.id),
    getSeriesZones(series.id),
  ]);

  // Only a paid registration is on the board, here as everywhere else.
  const onBoard = teams.filter((team) => team.paymentStatus === "paid");

  const podiumBlocks: PodiumBlock[] = podiums(onBoard).map((block) => ({
    label: bracketLabel(block.category, block.division),
    category: block.category,
    division: block.division,
    places: block.places.map((place) => ({
      id: place.id,
      rank: place.rank,
      name: place.name,
      studioName: place.studioName,
      total: place.total,
    })),
  }));

  // Ranked within its own bracket, then laid out bracket by bracket so the
  // table reads the way the podiums above it do.
  const rows: ResultRow[] = podiums(onBoard).flatMap((block) => {
    const ranked = rankBracket(onBoard, block.category, block.division);
    const unscored = onBoard.filter(
      (team) =>
        team.category === block.category && team.division === block.division && !team.submitted
    );

    return [...ranked, ...unscored.map((team) => ({ ...team, rank: 0 }))].map((team) => ({
      id: team.id,
      rank: team.rank,
      number: team.number,
      name: team.name,
      category: team.category,
      division: team.division,
      wave: team.wave,
      studioName: team.studioName,
      competitors: team.competitors.map((person) => person.fullName),
      submitted: team.submitted,
      total: team.total,
      zones: team.zones.map((zone) => ({
        number: zone.number,
        name: zone.name,
        points: zone.points,
      })),
    }));
  });

  const studios = [...new Set(onBoard.map((team) => team.studioName).filter(Boolean))].sort() as string[];

  // The public switch exists once the event is finished: publish, and the whole
  // field appears at /results exactly as a stranger sees it; unpublish, and it
  // drops back out. The busiest bracket is the public page's front door.
  const published =
    series.status === "final" &&
    series.resultsPublicAt !== null &&
    series.resultsPublicAt <= new Date();
  const front = podiumBlocks[0];
  const publicUrl = `/results/${series.slug}/${front?.category ?? "Womens"}/${front?.division ?? "Rookie"}`;

  if (detailId && !rows.some((team) => team.id === detailId)) notFound();

  if (detailId) return <div className="screen"><ResultsTable podiums={[]} rows={rows.filter(team => team.id === detailId)} brackets={[]} studios={[]} zoneNames={zones.map((zone) => ({number:zone.number,name:zone.name}))} exportHref={`/api/series/${series.slug}/export`} detailId={detailId} /></div>;

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Results")}</h1>
          <p>
            {t(
              "Ranked inside each bracket, never across them — the loads differ by category and division, so totals are only comparable within one."
            )}
          </p>
        </div>
      </div>

      {series.status === "final" ? (
        <div style={{ marginBottom: 18 }}>
          <PublishToggle seriesId={series.id} published={published} publicUrl={publicUrl} />
        </div>
      ) : null}

      {onBoard.length === 0 ? (
        <div className="notice">
          <strong>{t("Nothing to show yet.")}</strong>{" "}
          {t("Results appear once paid teams have scores.")}
        </div>
      ) : (
        <ResultsTable
          podiums={podiumBlocks}
          rows={rows}
          brackets={podiumBlocks.map((block) => block.label)}
          studios={studios}
          zoneNames={zones.map((zone) => ({ number: zone.number, name: zone.name }))}
          exportHref={`/api/series/${series.slug}/export`}
        />
      )}
    </div>
  );
}
