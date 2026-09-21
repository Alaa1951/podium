import "server-only";

import { prisma as defaultPrisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// THE CEILING ON WHAT THIS CAN COST.
//
// `rate-limit.ts` cannot do this job and says so itself: it is a Map in
// memory, it resets on every restart, and it multiplies by the instance count.
// That is fine for slowing down a login. As a budget on a paid API it is a
// number that forgets itself every deploy.
//
// So the day's count is a row, and claiming a slot is a GUARDED UPDATE — the
// same idiom that starts a wave exactly once. The realistic failure is several
// uploads landing in the same second near the ceiling: with a plain read-then-
// write they would all read "under the cap" and all proceed. With
// `UPDATE ... WHERE count < cap` exactly one of them is the one that tips it.
//
// Two limits, two different questions:
//   • per athlete — how many times may this one seat be re-rolled
//   • per day     — how much may the whole thing cost today
// ─────────────────────────────────────────────────────────────────────────────

type Db = Pick<typeof defaultPrisma, "portraitSpendCounter" | "portraitJob">;

/** How many generations one seat may ever ask for. */
export const MAX_ATTEMPTS_PER_SEAT = Number(process.env.PORTRAIT_MAX_ATTEMPTS ?? 3);

/** How many paid calls the whole system may make in a day. */
export const DAILY_CAP = Number(process.env.PORTRAIT_DAILY_CAP ?? 200);

/** "YYYY-MM-DD" in UTC — a key that needs no timezone arithmetic in a WHERE. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export type CapResult = { ok: true } | { ok: false; reason: "SEAT_LIMIT" | "DAILY_CAP" };

/**
 * Whether this seat has any generations left.
 *
 * A plain count, deliberately, and not a guarded write: the only realistic race
 * is one signed-in person double-tapping, which the button's own disabled state
 * already handles. Saying so here is cheaper than pretending otherwise.
 */
export async function seatHasAttemptsLeft(
  competitorId: string,
  db: Db = defaultPrisma
): Promise<boolean> {
  const used = await db.portraitJob.count({ where: { competitorId } });
  return used < MAX_ATTEMPTS_PER_SEAT;
}

/**
 * Take one slot out of today's budget, or refuse.
 *
 * Atomic. The row is created first if today has none, then claimed by a write
 * conditional on the count still being under the cap.
 */
export async function claimDailySlot(now: Date, db: Db = defaultPrisma): Promise<boolean> {
  const day = dayKey(now);
  await db.portraitSpendCounter.upsert({
    where: { day },
    create: { day, count: 0 },
    update: {},
  });
  const taken = await db.portraitSpendCounter.updateMany({
    where: { day, count: { lt: DAILY_CAP } },
    data: { count: { increment: 1 } },
  });
  return taken.count === 1;
}

/**
 * Give a slot back, for a job that was never created after all.
 *
 * Only ever called when the claim succeeded and the thing it was claimed for
 * then failed to start — never as a "refund" for a failed API call, because
 * that one was paid for.
 */
export async function releaseDailySlot(now: Date, db: Db = defaultPrisma): Promise<void> {
  await db.portraitSpendCounter.updateMany({
    where: { day: dayKey(now), count: { gt: 0 } },
    data: { count: { decrement: 1 } },
  });
}

/** Both limits, in the order a caller should learn about them. */
export async function checkCaps(
  competitorId: string,
  now: Date,
  db: Db = defaultPrisma
): Promise<CapResult> {
  if (!(await seatHasAttemptsLeft(competitorId, db))) return { ok: false, reason: "SEAT_LIMIT" };
  if (!(await claimDailySlot(now, db))) return { ok: false, reason: "DAILY_CAP" };
  return { ok: true };
}
