/**
 * Building the running order from the actions' side: who may, what is
 * refused before anything is written, and what a conflict leaves behind
 * (nothing). The planner itself is category-schedule.test.ts; the writes on
 * a real database are desk-schedule.integration.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(), transaction: vi.fn(), waveRow: vi.fn(), audit: vi.fn(), refresh: vi.fn(),
  series: { findUnique: vi.fn(), update: vi.fn() },
  wave: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), delete: vi.fn() },
  team: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  zoneScore: { count: vi.fn() },
  schedule: { loadScheduleContext: vi.fn(), isScheduled: vi.fn(), planFor: vi.fn(), applyPlan: vi.fn(), loadBlocks: vi.fn() },
}));
vi.mock("@/lib/session", () => ({ requireAccess: mocks.actor, getCurrentUser: mocks.actor, teamScope: () => ({}) }));
vi.mock("@/lib/prisma", () => ({ prisma: { wave: { findUnique: mocks.wave.findUnique } } }));
vi.mock("@/lib/wave-schedule-db", () => ({ scheduleTransaction: mocks.transaction, waveRowFor: mocks.waveRow }));
vi.mock("@/lib/audit", () => ({ AUDIT: {}, recordAudit: mocks.audit }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: mocks.refresh }));
vi.mock("@/lib/team-create", () => ({ nextTeamNumber: vi.fn() }));
vi.mock("@/lib/wave-clock", () => ({ fillFinisherTimes: vi.fn(), waveLengthFor: vi.fn() }));
vi.mock("@/lib/category-schedule-db", async () => {
  class ScheduleConflictError extends Error {
    constructor(readonly code: string, readonly conflicts: unknown[]) { super(code); }
  }
  return { ...mocks.schedule, ScheduleConflictError };
});
import { autoAssignWaves } from "@/lib/actions/teams";
import { arrangeWaveTimes, deleteWave, saveWave } from "@/lib/actions/waves";

const admin = { id: "admin", role: "admin", permissions: ["*"] };
const organiser = { id: "org", role: "organiser", permissions: ["waves.edit", "waves.placeTeams", "waves.view"] };
const judge = { id: "judge", role: "organiser", permissions: ["judgeSheet.view", "scores.enter"] };
const gym = { id: "gym", role: "studio", studioId: "s-a", permissions: ["waves.edit", "waves.placeTeams"] };
const plan = { waves: [{ number: 1, startTime: "09:00", block: "Mens", seats: [{ protected: false }] }], blocks: [{ category: "Mens", waves: 1 }], conflicts: [] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue(admin);
  mocks.transaction.mockImplementation(async (_id, work) => work({ series: mocks.series, wave: mocks.wave, team: mocks.team, zoneScore: mocks.zoneScore }));
  mocks.series.findUnique.mockResolvedValue({ id: "s", name: "Series", status: "scheduled", archivedAt: null, autoAssignEnabled: true, firstWaveTime: "07:00", waveIntervalMinutes: 20, waveMinutes: 115 });
  mocks.wave.count.mockResolvedValue(0);
  mocks.zoneScore.count.mockResolvedValue(0);
  mocks.wave.findMany.mockResolvedValue([{ id: "w1", number: 1, startTime: "08:12", status: "pending" }, { id: "w3", number: 3, startTime: "09:00", status: "pending" }]);
  mocks.team.findMany.mockResolvedValue([]);
  mocks.schedule.loadScheduleContext.mockResolvedValue({ blocks: [], autoAssign: true });
  mocks.schedule.isScheduled.mockReturnValue(true);
  mocks.schedule.planFor.mockReturnValue(plan);
  mocks.schedule.applyPlan.mockResolvedValue({ created: 1, kept: 0, renumbered: 0 });
  mocks.schedule.loadBlocks.mockResolvedValue([]);
  mocks.wave.findUnique.mockResolvedValue({ id: "w1", seriesId: "s", status: "pending", series: { archivedAt: null, status: "scheduled", autoAssignEnabled: true } });
});

describe("Auto Assign by category — who, and what is refused before anything is written", () => {
  it("runs for BFT MENA and an organiser, writes the plan with the chosen capacity, and audits it", async () => {
    for (const actor of [admin, organiser]) {
      mocks.actor.mockResolvedValue(actor);
      expect(await autoAssignWaves({ seriesId: "s", perWave: 7 })).toEqual({ ok: true });
    }
    expect(mocks.schedule.loadScheduleContext).toHaveBeenCalledWith(expect.anything(), "s", { capacity: 7 });
    expect(mocks.schedule.applyPlan).toHaveBeenCalledTimes(2);
    expect(mocks.series.update).toHaveBeenCalledWith({ where: { id: "s" }, data: { waveCapacity: 7 } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining("by category schedule") }));
  });

  it("is never a judge's, a gym's, or a preview's", async () => {
    for (const actor of [judge, gym, { ...admin, viewAs: { byAdminId: "x" } }]) {
      mocks.actor.mockResolvedValue(actor);
      expect(await autoAssignWaves({ seriesId: "s", perWave: 7 })).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("needs a complete category schedule — and leaves the current waves alone without one", async () => {
    mocks.schedule.isScheduled.mockReturnValue(false);
    expect(await autoAssignWaves({ seriesId: "s", perWave: 7 })).toEqual({ ok: false, error: "CATEGORY_SCHEDULE_MISSING" });
    expect(mocks.schedule.applyPlan).not.toHaveBeenCalled();
    expect(mocks.series.update).not.toHaveBeenCalled();
  });

  it("switched off in Settings, does not run and writes nothing", async () => {
    mocks.schedule.loadScheduleContext.mockResolvedValue({ blocks: [], autoAssign: false });
    expect(await autoAssignWaves({ seriesId: "s", perWave: 7 })).toEqual({ ok: false, error: "AUTO_ASSIGN_OFF" });
    expect(mocks.schedule.planFor).not.toHaveBeenCalled();
    expect(mocks.schedule.applyPlan).not.toHaveBeenCalled();
    expect(mocks.series.update).not.toHaveBeenCalled();
  });

  it("on any conflict writes nothing and says what does not fit", async () => {
    const conflicts = [{ kind: "OVERRUN", category: "Mens", shortByMinutes: 20 }];
    mocks.schedule.planFor.mockReturnValue({ ...plan, conflicts });
    expect(await autoAssignWaves({ seriesId: "s", perWave: 7 })).toEqual({ ok: false, error: "SCHEDULE_CONFLICT", conflicts });
    expect(mocks.schedule.applyPlan).not.toHaveBeenCalled();
    expect(mocks.series.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("refuses after any wave has started, and over recorded results", async () => {
    mocks.wave.count.mockResolvedValue(1);
    expect(await autoAssignWaves({ seriesId: "s", perWave: 7 })).toEqual({ ok: false, error: "WAVE_STARTED" });
    mocks.wave.count.mockResolvedValue(0);
    mocks.zoneScore.count.mockResolvedValue(3);
    expect(await autoAssignWaves({ seriesId: "s", perWave: 7 })).toEqual({ ok: false, error: "RESULTS_RECORDED" });
    expect(mocks.schedule.applyPlan).not.toHaveBeenCalled();
  });
});

describe("arranging and editing estimated times", () => {
  beforeEach(() => mocks.schedule.isScheduled.mockReturnValue(false));

  it("without a category schedule, replaces times in running order even when wave numbers have gaps", async () => {
    expect(await arrangeWaveTimes({ seriesId: "s" })).toEqual({ ok: true });
    expect(mocks.wave.update.mock.calls).toEqual([
      [{ where: { id: "w1" }, data: { startTime: "07:00" } }],
      [{ where: { id: "w3" }, data: { startTime: "07:20" } }],
    ]);
    expect(mocks.team.update).not.toHaveBeenCalled();
  });
  it("with a category schedule, leaves times to Auto Assign", async () => {
    mocks.schedule.isScheduled.mockReturnValue(true);
    expect(await arrangeWaveTimes({ seriesId: "s" })).toEqual({ ok: false, error: "CATEGORY_SCHEDULE_ACTIVE" });
    expect(mocks.wave.update).not.toHaveBeenCalled();
  });
  it("never moves a wave holding a team running manually", async () => {
    mocks.team.findMany.mockResolvedValue([{ number: 12 }]);
    expect(await arrangeWaveTimes({ seriesId: "s" })).toEqual({ ok: false, error: "PROTECTED_CONFLICT", teams: [12] });
    expect(await deleteWave({ waveId: "w1" })).toEqual({ ok: false, error: "PROTECTED_CONFLICT", teams: [12] });
    expect(mocks.wave.update).not.toHaveBeenCalled();
    expect(mocks.wave.delete).not.toHaveBeenCalled();
    expect(mocks.team.updateMany).not.toHaveBeenCalled();
  });
  it("with Auto Assign switched off, arranges, re-times and deletes by hand — no block or running-manually refusal", async () => {
    mocks.series.findUnique.mockResolvedValue({ id: "s", name: "Series", status: "scheduled", archivedAt: null, autoAssignEnabled: false, firstWaveTime: "07:00", waveIntervalMinutes: 20, waveMinutes: 115 });
    mocks.wave.findUnique.mockResolvedValue({ id: "w1", seriesId: "s", status: "pending", series: { archivedAt: null, status: "scheduled", autoAssignEnabled: false } });
    mocks.schedule.isScheduled.mockReturnValue(true);
    mocks.team.findMany.mockResolvedValue([{ number: 12 }]);
    expect(await arrangeWaveTimes({ seriesId: "s" })).toEqual({ ok: true });
    expect(mocks.wave.update).toHaveBeenCalledWith({ where: { id: "w1" }, data: { startTime: "07:00" } });
    mocks.wave.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "w1", number: 1, startTime: "09:00", status: "pending" });
    expect(await saveWave({ seriesId: "s", waveId: "w1", number: 1, startTime: "09:40" })).toEqual({ ok: true });
    expect(await deleteWave({ waveId: "w1" })).toEqual({ ok: true });
    expect(mocks.wave.delete).toHaveBeenCalledWith({ where: { id: "w1" } });
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
    mocks.wave.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "w1", number: 1, startTime: "09:00", status: "pending" });
    expect(await saveWave({ seriesId: "s", waveId: "w1", number: 2, startTime: "09:35" })).toEqual({ ok: true });
    expect(mocks.wave.update).toHaveBeenCalledExactlyOnceWith({ where: { id: "w1" }, data: { number: 2, startTime: "09:35" } });
    expect(mocks.team.updateMany).toHaveBeenCalledWith({ where: { waveId: "w1" }, data: { wave: 2 } });
  });
  it("asks before changing a wave that holds teams running manually, then changes it on confirmation", async () => {
    mocks.team.findMany.mockResolvedValue([{ number: 7 }]);
    mocks.wave.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "w1", number: 1, startTime: "09:00", status: "pending" });
    expect(await saveWave({ seriesId: "s", waveId: "w1", number: 1, startTime: "09:40" })).toEqual({ ok: false, error: "PROTECTED_WAVE", teams: [7] });
    expect(mocks.wave.update).not.toHaveBeenCalled();
    mocks.wave.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "w1", number: 1, startTime: "09:00", status: "pending" });
    expect(await saveWave({ seriesId: "s", waveId: "w1", number: 1, startTime: "09:40", confirmProtected: true })).toEqual({ ok: true });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining("running manually — confirmed") }));
  });
  it("scopes edits to the requested competition", async () => {
    mocks.wave.findFirst.mockResolvedValue(null);
    expect(await saveWave({ seriesId: "s", waveId: "other-series-wave", number: 2, startTime: "09:35" })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(mocks.wave.findFirst).toHaveBeenLastCalledWith({ where: { id: "other-series-wave", seriesId: "s" } });
  });
  it("blocks all schedule changes in preview mode and for a judge", async () => {
    for (const actor of [{ ...admin, viewAs: {} }, judge]) {
      mocks.actor.mockResolvedValue(actor);
      expect(await arrangeWaveTimes({ seriesId: "s" })).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await autoAssignWaves({ seriesId: "s", perWave: 7 })).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await saveWave({ seriesId: "s", number: 1 })).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await deleteWave({ waveId: "w1" })).toEqual({ ok: false, error: "FORBIDDEN" });
    }
  });
});
