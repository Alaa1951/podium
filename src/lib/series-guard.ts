import type { SeriesStatus } from "@/generated/prisma/enums";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT MAY BE CHANGED OR REMOVED, AND WHEN.
//
// A competition moves through three states, and the room for destructive
// actions shrinks as it does:
//
//   SCHEDULED  nothing has happened yet. Mistakes are expected here, so
//              everything may be edited, archived or deleted.
//   LIVE       the event is on the floor. Nobody deletes anything — a row
//              vanishing from a live board is indistinguishable from a crash.
//   FINAL      the event is part of the record. Deletion is never allowed, for
//              any role; corrections happen through the score flows instead.
//
// Pure and dependency-free so the rules can be tested directly, the way
// visibility.ts is.
// ─────────────────────────────────────────────────────────────────────────────

export type DeletionGuard = { allowed: true } | { allowed: false; reason: "EVENT_RUNNING" | "EVENT_FINISHED" };

/**
 * May rows inside this competition (teams, waves, zones) be archived or
 * deleted? Only while it is scheduled.
 */
export function deletionGuard(status: SeriesStatus): DeletionGuard {
  if (status === "live") return { allowed: false, reason: "EVENT_RUNNING" };
  if (status === "final") return { allowed: false, reason: "EVENT_FINISHED" };
  return { allowed: true };
}

/**
 * May the competition ITSELF be archived? Same rule as its rows — and a live
 * or finished competition is never removable, by anyone.
 */
export function seriesArchiveGuard(status: SeriesStatus): DeletionGuard {
  return deletionGuard(status);
}
