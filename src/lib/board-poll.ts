import "server-only";

import { buildBoardPayload } from "@/lib/board";

/**
 * ONE BUILD SERVES EVERY POLL THAT ARRIVES WITHIN A SECOND.
 *
 * On the day every signed-in phone, every rig screen and both venue walls ask
 * for a board every ten seconds, and each build reads the whole field.
 * Requests that land while a build is running wait for that build, and its
 * result is reused for a second after — so a room of a few hundred screens
 * costs a handful of builds per poll cycle, not hundreds. A second is well
 * inside the poll interval; a screen served a shared copy counts down at most
 * a second behind the one that triggered the build.
 *
 * Shared by the signed-in board's poll (/api/series/[series]/board) and the
 * public wall's poll (/api/live/[series]/board), so both read the same build
 * rather than doubling the work.
 */
const SHARE_MS = 1000;
const shared = new Map<string, { at: number; payload: Promise<Awaited<ReturnType<typeof buildBoardPayload>>> }>();

export function sharedBoardPayload(series: string) {
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
