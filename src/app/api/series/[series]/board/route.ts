import { NextResponse } from "next/server";

import { buildBoardPayload } from "@/lib/board";
import { getSeriesState } from "@/lib/series-state";
import { getCurrentUser } from "@/lib/session";
import { readsWholeBoard } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/**
 * ONE BUILD SERVES EVERY POLL THAT ARRIVES WITHIN A SECOND.
 *
 * On the day every signed-in phone and every rig screen asks for this every
 * ten seconds, and each build reads the whole field. Requests that land
 * while a build is running wait for that build, and its result is reused for
 * a second after — so a room of a few hundred phones costs a handful of
 * builds per poll cycle, not hundreds. A second is well inside the poll
 * interval; a screen served a shared copy counts down at most a second
 * behind the one that triggered the build.
 */
const SHARE_MS = 1000;
const shared = new Map<string, { at: number; payload: Promise<Awaited<ReturnType<typeof buildBoardPayload>>> }>();

function sharedPayload(series: string) {
  const now = Date.now();
  const hit = shared.get(series);
  if (hit && now - hit.at < SHARE_MS) return hit.payload;
  const payload = buildBoardPayload(series);
  shared.set(series, { at: now, payload });
  // A failed build is not kept: the next poll tries again.
  payload.catch(() => shared.delete(series));
  if (shared.size > 50) {
    for (const [key, entry] of shared) if (now - entry.at >= SHARE_MS) shared.delete(key);
  }
  return payload;
}

/**
 * Polled by the live board so scores appear as they are entered without a page
 * reload.
 *
 * The same rule the board page applies, through boardAccess: BFT MENA always;
 * every other signed-in account once the event is live or finished — that is
 * exactly what a live leaderboard promises them. The floor supervisor
 * (waveControl.view) as well, so the rig screens can be set up before the day
 * starts (readsWholeBoard). While the event is still
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
  if (!readsWholeBoard(user, state.phase)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const payload = await sharedPayload(series);
  if (!payload) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
