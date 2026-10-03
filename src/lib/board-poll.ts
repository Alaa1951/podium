import "server-only";

import { buildBoardPayload } from "@/lib/board";
import { boardCacheEpoch } from "@/lib/board-events";

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
const shared = new Map<string, { at: number; epoch: number; payload: Promise<Awaited<ReturnType<typeof buildBoardPayload>>> }>();

async function latestBoardPayload(series: string) {
  // A write can commit while a build is reading the field. Retry that build so
  // an event-triggered fetch cannot win the race with an older in-flight poll.
  // Bound this to one reread: a room of judges counting continuously must not
  // keep a fetch running forever. The client queues later events as new pulls.
  const epoch = boardCacheEpoch();
  const payload = await buildBoardPayload(series);
  return epoch === boardCacheEpoch() ? payload : buildBoardPayload(series);
}

export function sharedBoardPayload(series: string) {
  const now = Date.now();
  const epoch = boardCacheEpoch();
  const hit = shared.get(series);
  if (hit && hit.epoch === epoch && now - hit.at < SHARE_MS) return hit.payload;
  const payload = latestBoardPayload(series);
  const entry = { at: now, epoch, payload };
  shared.set(series, entry);
  // A failed build is not kept: the next poll tries again.
  payload.catch(() => { if (shared.get(series) === entry) shared.delete(series); });
  if (shared.size > 50) {
    for (const [key, entry] of shared) if (now - entry.at >= SHARE_MS) shared.delete(key);
  }
  return payload;
}
