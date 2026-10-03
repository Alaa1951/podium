import { NextResponse } from "next/server";

import { boardEventResponse } from "@/lib/board-stream";
import { getSeriesState } from "@/lib/series-state";
import { getCurrentUser } from "@/lib/session";
import { readsWholeBoard } from "@/lib/visibility";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Same access as the signed-in board poll; changes contain no score data. */
export async function GET(request: Request, ctx: { params: Promise<{ series: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { series } = await ctx.params;
  const state = await getSeriesState(series);
  if (!state) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!readsWholeBoard(user, state.phase)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  return boardEventResponse(request, state.series.id);
}
