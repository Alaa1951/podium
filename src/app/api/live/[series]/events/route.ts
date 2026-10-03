import { NextResponse } from "next/server";

import { boardEventResponse } from "@/lib/board-stream";
import { getSeriesState } from "@/lib/series-state";
import { wallView } from "@/lib/visibility";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Same phase gate as the anonymous venue wall's board poll. */
export async function GET(request: Request, ctx: { params: Promise<{ series: string }> }) {
  const { series } = await ctx.params;
  const state = await getSeriesState(series);
  if (!state || wallView(state.phase) !== "board") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return boardEventResponse(request, state.series.id);
}
