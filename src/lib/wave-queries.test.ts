import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ waves: vi.fn(), update: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  wave: { findMany: mocks.waves, update: mocks.update }, $transaction: mocks.transaction,
} }));
vi.mock("@/lib/session", () => ({ accountScope: () => ({}) }));

import { getSeriesWaves } from "@/lib/queries-people";

const now = new Date("2026-09-18T10:00:00Z");
const wave = {
  id: "wave-1", number: 1, status: "running", capacity: 9, durationMinutes: 20,
  startTime: "10:00", startedAt: now, endsAt: new Date(now.getTime() + 20 * 60_000),
  series: { status: "live" }, teams: [{ score: { status: "submitted" } }, { score: null }],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(now);
  mocks.waves.mockResolvedValue([wave]);
  mocks.transaction.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("wave reads and clock progression", () => {
  it("reads a live schedule once when no clock has expired and retains score counts", async () => {
    expect(await getSeriesWaves("series-1")).toMatchObject([
      { id: "wave-1", status: "running", teamCount: 2, scoredCount: 1, remainingMs: 20 * 60_000 },
    ]);
    expect(mocks.waves).toHaveBeenCalledTimes(1);
    expect(mocks.waves.mock.lastCall?.[0].where).toEqual({ seriesId: "series-1" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("commits the expired wave and returns a fresh snapshot after the next wave starts", async () => {
    const expired = { ...wave, endsAt: new Date(now.getTime() - 20 * 60_000) };
    const next = { ...wave, id: "wave-2", number: 2, status: "pending", startedAt: null, endsAt: null };
    mocks.waves.mockResolvedValueOnce([expired, next]).mockResolvedValueOnce([
      { ...expired, status: "complete" }, { ...next, status: "running", startedAt: now, endsAt: wave.endsAt },
    ]);
    const result = await getSeriesWaves("series-1");
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "wave-1" }, data: { status: "complete" } });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "wave-2" } }));
    expect(mocks.waves).toHaveBeenCalledTimes(2);
    expect(result.map(row => row.status)).toEqual(["complete", "running"]);
  });

  it("never advances clocks in a final competition", async () => {
    mocks.waves.mockResolvedValue([{ ...wave, endsAt: new Date(0), series: { status: "final" } }]);
    await getSeriesWaves("series-1");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.waves).toHaveBeenCalledTimes(1);
  });

  it("returns an empty schedule without writes", async () => {
    mocks.waves.mockResolvedValue([]);
    expect(await getSeriesWaves("missing")).toEqual([]);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
