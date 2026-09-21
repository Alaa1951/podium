import { notFound } from "next/navigation";

import { BoardFrame } from "@/components/board/board-frame";
import { ZoneStationsDisplay } from "@/components/board/station-display";
import { buildBoardPayload } from "@/lib/board";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { getCurrentUser } from "@/lib/session";
import { boardAccess } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/**
 * EVERY RIG IN ONE ZONE — /series/<slug>/zone/<zone>/stations
 *
 * For a venue with one screen per zone rather than one per rig, which is the
 * common case when there are fewer screens than the nine stations a wave can
 * fill. Same payload, same poll, same access bar as the single-rig screen.
 */
export default async function ZoneStationsPage(
  props: PageProps<"/series/[series]/zone/[zone]/stations">
) {
  const user = await getCurrentUser();
  if (!user) notFound();

  const { zone } = await props.params;
  const zoneNumber = Number(zone);
  if (!Number.isInteger(zoneNumber) || zoneNumber < 1) notFound();

  const { series, phase } = await requireSeries(props.params);
  const access = boardAccess(user.role, phase);
  if (!access.canSeeBoard || access.scope !== "all") notFound();

  const payload = await buildBoardPayload(series.id);
  if (!payload) notFound();
  const zoneDef = payload.zoneDefs.find((one) => one.number === zoneNumber);
  if (!zoneDef) notFound();

  return (
    <BoardFrame back={seriesHref(series.slug)} name={series.name} seriesSlug={series.slug}>
      <ZoneStationsDisplay initial={payload} zoneNumber={zoneNumber} zoneName={zoneDef.name} />
    </BoardFrame>
  );
}
