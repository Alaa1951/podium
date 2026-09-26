import { notFound } from "next/navigation";

import { BoardFrame } from "@/components/board/board-frame";
import { StationDisplay } from "@/components/board/station-display";
import { buildBoardPayload } from "@/lib/board";
import { MAX_STATIONS } from "@/lib/floor";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { getCurrentUser } from "@/lib/session";
import { readsWholeBoard } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/**
 * ONE RIG'S SCREEN — /series/<slug>/station/<zone>/<station>
 *
 * The address is (zone × station) rather than a station alone, because a team
 * keeps its station number in every zone of its wave and several waves are on
 * the floor at once. Station 3 of zone 1 and station 3 of zone 2 hold two
 * different pairs at the same moment (stations.ts explains it in full).
 *
 * ACCESS: `scope === "all"`, the same bar as the board's own API route, and
 * stricter than `canSeeBoard`. Before an event a studio's scope is "own", and
 * this screen names every pair on the floor — the fact that nothing is running
 * yet is not a reason to hand over the field.
 */
export default async function StationPage(
  props: PageProps<"/series/[series]/station/[zone]/[station]">
) {
  const user = await getCurrentUser();
  if (!user) notFound();

  const { zone, station } = await props.params;
  const zoneNumber = Number(zone);
  const stationNumber = Number(station);
  if (!Number.isInteger(zoneNumber) || zoneNumber < 1) notFound();
  if (!Number.isInteger(stationNumber) || stationNumber < 1 || stationNumber > MAX_STATIONS) {
    notFound();
  }

  const { series, phase } = await requireSeries(props.params);
  if (!readsWholeBoard(user, phase)) notFound();

  const payload = await buildBoardPayload(series.id);
  if (!payload) notFound();

  // A zone the competition does not define has no rig to stand on.
  const zoneDef = payload.zoneDefs.find((one) => one.number === zoneNumber);
  if (!zoneDef) notFound();

  return (
    <BoardFrame back={seriesHref(series.slug)} name={series.name} seriesSlug={series.slug}>
      <StationDisplay
        initial={payload}
        zoneNumber={zoneNumber}
        station={stationNumber}
        zoneName={zoneDef.name}
      />
    </BoardFrame>
  );
}
