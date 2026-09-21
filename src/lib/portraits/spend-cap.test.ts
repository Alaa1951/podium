/**
 * The ceiling on what portraits can cost.
 *
 * The load-bearing test is the concurrent one. A budget checked by reading a
 * number and then writing it is not a budget: several uploads landing in the
 * same second all read "under the cap" and all proceed, and the bill is
 * whatever arrived that second. So the fake counter below is written to behave
 * like the database does — a conditional UPDATE that either matches a row or
 * does not — and the test drives it with `Promise.all` to prove the guard is
 * what holds, rather than luck in the ordering.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The subject imports the real client for its DEFAULT argument only; every
// test passes its own. Mocked so importing it does not open a connection.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { checkCaps, claimDailySlot, dayKey, DAILY_CAP, MAX_ATTEMPTS_PER_SEAT, releaseDailySlot, seatHasAttemptsLeft } from "@/lib/portraits/spend-cap";

const NOW = new Date("2026-09-21T13:00:00.000Z");

/** A counter table that enforces the WHERE clause, like MariaDB would. */
function fakeDb(jobsPerCompetitor: Record<string, number> = {}) {
  const days = new Map<string, number>();
  return {
    days,
    portraitSpendCounter: {
      async upsert({ where, create }: { where: { day: string }; create: { day: string; count: number } }) {
        if (!days.has(where.day)) days.set(where.day, create.count);
        return { day: where.day, count: days.get(where.day)! };
      },
      async updateMany({
        where,
        data,
      }: {
        where: { day: string; count?: { lt?: number; gt?: number } };
        data: { count: { increment?: number; decrement?: number } };
      }) {
        const current = days.get(where.day);
        if (current === undefined) return { count: 0 };
        if (where.count?.lt !== undefined && !(current < where.count.lt)) return { count: 0 };
        if (where.count?.gt !== undefined && !(current > where.count.gt)) return { count: 0 };
        days.set(where.day, current + (data.count.increment ?? 0) - (data.count.decrement ?? 0));
        return { count: 1 };
      },
    },
    portraitJob: {
      async count({ where }: { where: { competitorId: string } }) {
        return jobsPerCompetitor[where.competitorId] ?? 0;
      },
    },
  };
}

type Db = Parameters<typeof claimDailySlot>[1];

describe("the day key", () => {
  it("is UTC, so a competition evening does not straddle two budgets by accident", () => {
    expect(dayKey(new Date("2026-09-21T23:59:59.000Z"))).toBe("2026-09-21");
    expect(dayKey(new Date("2026-09-22T00:00:01.000Z"))).toBe("2026-09-22");
  });
});

describe("the daily cap", () => {
  let db: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    db = fakeDb();
  });

  it("hands out slots up to the cap and then refuses", async () => {
    for (let i = 0; i < DAILY_CAP; i++) {
      expect(await claimDailySlot(NOW, db as unknown as Db)).toBe(true);
    }
    expect(await claimDailySlot(NOW, db as unknown as Db)).toBe(false);
    expect(db.days.get("2026-09-21")).toBe(DAILY_CAP);
  });

  it("holds under a burst — the whole reason it is a guarded write", async () => {
    // Twice the cap, all at once. Exactly DAILY_CAP may succeed; a read-then-
    // write implementation passes them all and bills for every one.
    const attempts = Array.from({ length: DAILY_CAP * 2 }, () =>
      claimDailySlot(NOW, db as unknown as Db)
    );
    const granted = (await Promise.all(attempts)).filter(Boolean).length;
    expect(granted).toBe(DAILY_CAP);
    expect(db.days.get("2026-09-21")).toBe(DAILY_CAP);
  });

  it("starts the next day fresh", async () => {
    for (let i = 0; i < DAILY_CAP; i++) await claimDailySlot(NOW, db as unknown as Db);
    const tomorrow = new Date("2026-09-22T09:00:00.000Z");
    expect(await claimDailySlot(tomorrow, db as unknown as Db)).toBe(true);
  });

  it("gives a slot back, but never below zero", async () => {
    await claimDailySlot(NOW, db as unknown as Db);
    await releaseDailySlot(NOW, db as unknown as Db);
    expect(db.days.get("2026-09-21")).toBe(0);
    await releaseDailySlot(NOW, db as unknown as Db);
    expect(db.days.get("2026-09-21")).toBe(0);
  });
});

describe("the per-seat limit", () => {
  it("stops a seat past its attempts", async () => {
    const db = fakeDb({ busy: MAX_ATTEMPTS_PER_SEAT, fresh: 0 });
    expect(await seatHasAttemptsLeft("fresh", db as unknown as Db)).toBe(true);
    expect(await seatHasAttemptsLeft("busy", db as unknown as Db)).toBe(false);
  });
});

describe("both together", () => {
  it("reports the seat limit WITHOUT spending a daily slot", async () => {
    // Order matters: checking the cheap, per-person limit first means a seat
    // that is out of attempts cannot burn a slot out of the shared budget.
    const db = fakeDb({ busy: MAX_ATTEMPTS_PER_SEAT });
    expect(await checkCaps("busy", NOW, db as unknown as Db)).toEqual({
      ok: false,
      reason: "SEAT_LIMIT",
    });
    expect(db.days.get("2026-09-21")).toBeUndefined();
  });

  it("reports the daily cap once the budget is gone", async () => {
    const db = fakeDb();
    for (let i = 0; i < DAILY_CAP; i++) await claimDailySlot(NOW, db as unknown as Db);
    expect(await checkCaps("fresh", NOW, db as unknown as Db)).toEqual({
      ok: false,
      reason: "DAILY_CAP",
    });
  });

  it("takes exactly one slot when it says yes", async () => {
    const db = fakeDb();
    expect(await checkCaps("fresh", NOW, db as unknown as Db)).toEqual({ ok: true });
    expect(db.days.get("2026-09-21")).toBe(1);
  });
});
