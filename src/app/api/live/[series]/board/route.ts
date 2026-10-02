import { NextResponse } from "next/server";

import { sharedBoardPayload } from "@/lib/board-poll";
import { getSeriesState } from "@/lib/series-state";
import { wallView } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/**
 * The venue wall's poll — /live/[series] refreshes itself from here.
 *
 * The same payload the signed-in board reads, gated by wallView instead of an
 * account: a live event's board and a published event's leaderboard are open
 * to anyone with the link (that is the link's job), and everything else — the
 * field before the doors open, the final ranking before resultsPublicAt — is
 * a 404 rather than a leak. The wall page reacts to those phases on its own
 * (countdown, results-soon), so a 404 here is the expected answer whenever
 * there is nothing to show.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/live/[series]/board">) {
  const { series } = await ctx.params;
  const state = await getSeriesState(series);
  if (!state) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (wallView(state.phase) !== "board") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const payload = await sharedBoardPayload(series);
  if (!payload) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
