import { NextResponse } from "next/server";

import { buildBoardPayload } from "@/lib/board";
import { getSeriesState } from "@/lib/series-state";
import { getCurrentUser } from "@/lib/session";
import { boardAccess } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/**
 * Polled by the live board so scores appear as they are entered without a page
 * reload.
 *
 * The same rule the board page applies, through boardAccess: BFT MENA always;
 * every other signed-in account once the event is live or finished — that is
 * exactly what a live leaderboard promises them. While the event is still
 * being scheduled the payload carries drafts and unreleased waves, so nobody
 * but BFT MENA reads it.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/series/[series]/board">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { series } = await ctx.params;
  const state = await getSeriesState(series);
  if (!state) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // Before the event everyone signed in may open the board page — it shows the
  // countdown — but the payload carries drafts and unreleased waves, so only an
  // account whose access covers the whole field reads it.
  const access = boardAccess(user.role, state.phase);
  if (!access.canSeeBoard || access.scope !== "all") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const payload = await buildBoardPayload(series);
  if (!payload) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
