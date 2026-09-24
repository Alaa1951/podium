import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(), transaction: vi.fn(), waveRow: vi.fn(), audit: vi.fn(), refresh: vi.fn(),
  series: { findUnique: vi.fn(), update: vi.fn() },
  wave: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  team: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/session", () => ({ requireAccess: mocks.actor, teamScope: () => ({}) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/wave-schedule-db", () => ({ scheduleTransaction: mocks.transaction, waveRowFor: mocks.waveRow }));
vi.mock("@/lib/audit", () => ({ AUDIT: {}, recordAudit: mocks.audit }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: mocks.refresh }));
vi.mock("@/lib/team-create", () => ({ nextTeamNumber: vi.fn() }));
vi.mock("@/lib/wave-clock", () => ({ fillFinisherTimes: vi.fn(), waveLengthFor: vi.fn() }));
import { autoAssignWaves } from "@/lib/actions/teams";
import { arrangeWaveTimes, saveWave } from "@/lib/actions/waves";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue({ id: "admin", role: "admin" });
  mocks.transaction.mockImplementation(async (_id, work) => work({ series: mocks.series, wave: mocks.wave, team: mocks.team }));
  mocks.series.findUnique.mockResolvedValue({ id: "s", status: "scheduled", archivedAt: null, firstWaveTime: "07:00", waveIntervalMinutes: 20, waveMinutes: 115 });
  mocks.wave.count.mockResolvedValue(0);
  mocks.wave.findMany.mockResolvedValue([{ id: "w1", number: 1, startTime: "08:12", status: "pending" }, { id: "w3", number: 3, startTime: "09:00", status: "pending" }]);
  mocks.team.findMany.mockResolvedValue([]);
  mocks.waveRow.mockImplementation(async (_tx, _series, number) => ({ id: `w${number}` }));
});

describe("rebuilding the assignment", () => {
  it("uses only eligible teams and updates capacity and assignments in one transaction", async () => {
    mocks.team.findMany.mockResolvedValue([
      { id: "woman", category: "Womens", division: "Rookie", number: 1 },
      { id: "man", category: "Mens", division: "Pro", number: 2 },
      { id: "mixed", category: "Mixed", division: "Open", number: 3 },
    ]);
    expect(await autoAssignWaves({ seriesId: "s", perWave: 2 })).toEqual({ ok: true });
    expect(mocks.team.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { seriesId: "s", archivedAt: null, waitlistedAt: null } }));
    expect(mocks.series.update).toHaveBeenCalledWith({ where: { id: "s" }, data: { waveCapacity: 2 } });
    expect(mocks.team.update.mock.calls.map(([arg]) => [arg.where.id, arg.data.wave, arg.data.station])).toEqual([["man", 1, 1], ["mixed", 1, 2], ["woman", 2, 1]]);
    expect(mocks.wave.updateMany).toHaveBeenCalledWith({ where: { seriesId: "s" }, data: { capacity: 2, durationMinutes: 115 } });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it("clears unused waves for an empty field without creating a phantom wave", async () => {
    expect(await autoAssignWaves({ seriesId: "s", perWave: 7 })).toEqual({ ok: true });
    expect(mocks.waveRow).not.toHaveBeenCalled();
    expect(mocks.wave.deleteMany).toHaveBeenCalledWith({ where: { seriesId: "s", number: { gt: 0 } } });
  });
  it("refuses all rebuilding after any wave has started", async () => {
    mocks.wave.count.mockResolvedValue(1);
    expect(await autoAssignWaves({ seriesId: "s", perWave: 7 })).toEqual({ ok: false, error: "WAVE_STARTED" });
    expect(mocks.team.updateMany).not.toHaveBeenCalled();
  });
});

describe("arranging and editing estimated times", () => {
  it("replaces manual times in running order even when wave numbers have gaps", async () => {
    expect(await arrangeWaveTimes({ seriesId: "s" })).toEqual({ ok: true });
    expect(mocks.wave.update.mock.calls).toEqual([
      [{ where: { id: "w1" }, data: { startTime: "07:00" } }],
      [{ where: { id: "w3" }, data: { startTime: "07:20" } }],
    ]);
    expect(mocks.team.update).not.toHaveBeenCalled();
  });
  it("validates the whole schedule before writing any times", async () => {
    mocks.series.findUnique.mockResolvedValue({ status: "scheduled", firstWaveTime: "23:50", waveIntervalMinutes: 20 });
    expect(await arrangeWaveTimes({ seriesId: "s" })).toEqual({ ok: false, error: "SCHEDULE_EXCEEDS_DAY" });
    expect(mocks.wave.update).not.toHaveBeenCalled();
  });
  it("refuses rearranging a running or completed schedule", async () => {
    mocks.wave.findMany.mockResolvedValue([{ status: "complete" }]);
    expect(await arrangeWaveTimes({ seriesId: "s" })).toEqual({ ok: false, error: "WAVE_STARTED" });
  });
  it("edits only the chosen pending wave and keeps team wave numbers consistent", async () => {
    mocks.wave.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "w1", status: "pending" });
    expect(await saveWave({ seriesId: "s", waveId: "w1", number: 2, startTime: "09:35" })).toEqual({ ok: true });
    expect(mocks.wave.update).toHaveBeenCalledExactlyOnceWith({ where: { id: "w1" }, data: { number: 2, startTime: "09:35" } });
    expect(mocks.team.updateMany).toHaveBeenCalledWith({ where: { waveId: "w1" }, data: { wave: 2 } });
  });
  it("scopes edits to the requested competition", async () => {
    mocks.wave.findFirst.mockResolvedValue(null);
    expect(await saveWave({ seriesId: "s", waveId: "other-series-wave", number: 2, startTime: "09:35" })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(mocks.wave.findFirst).toHaveBeenLastCalledWith({ where: { id: "other-series-wave", seriesId: "s" } });
  });
  it("blocks all schedule changes in preview mode", async () => {
    mocks.actor.mockResolvedValue({ id: "admin", viewAs: {} });
    expect(await arrangeWaveTimes({ seriesId: "s" })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await autoAssignWaves({ seriesId: "s", perWave: 7 })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await saveWave({ seriesId: "s", number: 1 })).toEqual({ ok: false, error: "FORBIDDEN" });
  });
});
