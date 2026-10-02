import { NextResponse } from "next/server";

import { getSeriesState } from "@/lib/series-state";

export const dynamic = "force-dynamic";

/**
 * Where the event is, for the wall that is already hanging on it.
 *
 * The wall page is a server render of one phase; when the phase moves — the
 * countdown runs out, the last wave finishes, results are published — the
 * screen has to become the next thing without anybody clicking anything. The
 * wall polls this every twenty seconds and reloads itself when the phase
 * changes, which re-renders the page behind the same URL.
 *
 * The phase is coarse (before / live / results / public) and is exactly what
 * the venue screens are showing the room anyway; no field data travels here.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/live/[series]/status">) {
  const { series } = await ctx.params;
  const state = await getSeriesState(series);
  if (!state) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json(
    { phase: state.phase },
    { headers: { "Cache-Control": "no-store" } },
  );
}
