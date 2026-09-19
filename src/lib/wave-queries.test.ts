import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  waves: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  fill: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  wave: { findMany: mocks.waves }, $transaction: mocks.transaction,
} }));
vi.mock("@/lib/session", () => ({ accountScope: () => ({}) }));
vi.mock("@/lib/wave-clock", () => ({ fillFinisherTimes: mocks.fill }));

import { getSeriesWaves } from "@/lib/queries-people";

const now = new Date("2026-09-18T10:00:00Z");
const series = { status: "live", zoneWorkMinutes: 15, zoneBreakMinutes: 5, _count: { zones: 4 } };
const wave = {
  id: "wave-1", number: 1, status: "running", capacity: 9, durationMinutes: 75,
  startTime: "10:00", startedAt: now, endsAt: new Date(now.getTime() + 75 * 60_000),
  series, teams: [{ score: { status: "submitted" } }, { score: null }],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(now);
  mocks.waves.mockResolvedValue([wave]);
  // The sweep runs inside an interactive transaction.
  mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) =>
    work({ wave: { updateMany: mocks.updateMany } })
  );
  mocks.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.useRealTimers());

describe("wave reads and clock progression", () => {
  it("reads a live schedule once when no clock has expired and retains score counts", async () => {
    expect(await getSeriesWaves("series-1")).toMatchObject([
      { id: "wave-1", status: "running", teamCount: 2, scoredCount: 1, remainingMs: 75 * 60_000 },
    ]);
    expect(mocks.waves).toHaveBeenCalledTimes(1);
    expect(mocks.waves.mock.lastCall?.[0].where).toEqual({ seriesId: "series-1" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("says where a running wave is on the floor", async () => {
    vi.setSystemTime(new Date(now.getTime() + 22 * 60_000));
    const [row] = await getSeriesWaves("series-1");
    expect(row.floor).toEqual({ phase: "work", zoneNumber: 2, phaseRemainingMs: 13 * 60_000 });
  });

  it("ends an expired wave, fills the finisher clock, and never starts the next one", async () => {
    const expired = { ...wave, endsAt: new Date(now.getTime() - 60_000) };
    const next = { ...wave, id: "wave-2", number: 2, status: "pending", startedAt: null, endsAt: null };
    mocks.waves.mockResolvedValueOnce([expired, next]).mockResolvedValueOnce([
      { ...expired, status: "complete" }, next,
    ]);
    const result = await getSeriesWaves("series-1");
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "wave-1", status: "running" }, data: { status: "complete" } });
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.fill).toHaveBeenCalledWith(expect.anything(), { id: "wave-1", seriesId: "series-1" }, 0);
    expect(result.map((row) => row.status)).toEqual(["complete", "pending"]);
  });

  it("fills nothing when another reader already ended the wave", async () => {
    mocks.waves.mockResolvedValue([{ ...wave, endsAt: new Date(now.getTime() - 60_000) }]);
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await getSeriesWaves("series-1");
    expect(mocks.fill).not.toHaveBeenCalled();
  });

  it("never advances clocks in a final competition", async () => {
    mocks.waves.mockResolvedValue([{ ...wave, endsAt: new Date(0), series: { ...series, status: "final" } }]);
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
