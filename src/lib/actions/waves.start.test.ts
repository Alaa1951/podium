/**
 * Starting a wave with a team of one athlete (decision D3b): refused, naming
 * the team, once the incomplete-team policy is switched on — and exactly as
 * before while it is off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    wave: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    zone: { count: vi.fn().mockResolvedValue(3) },
    zoneScore: { count: vi.fn().mockResolvedValue(0) },
  };
  return { tx, user: vi.fn(), blockers: vi.fn(), audit: vi.fn() };
});
// Readiness (waiver, entrance, warm-up) is its own check, tested against a
// real database in wave-start.integration.test.ts; here it answers "ready".
vi.mock("@/lib/wave-start-check", () => ({ waveStartBlockers: mocks.blockers }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.user, requireAccess: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { wave: { findUnique: vi.fn().mockResolvedValue({ seriesId: "s1" }) }, zoneStaff: { count: vi.fn().mockResolvedValue(0) } } }));
vi.mock("@/lib/wave-schedule-db", () => ({ scheduleTransaction: (_series: string, work: (tx: unknown) => unknown) => work(mocks.tx), waveRowFor: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.audit, AUDIT: { waveControlled: "wave" } }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: vi.fn() }));

import { controlWave } from "@/lib/actions/waves";

const team = (number: number, seats: number, over: object = {}) => ({ number, station: number, paymentStatus: "paid", waitlistedAt: null, _count: { competitors: seats }, ...over });
const wave = (teams: object[]) => ({
  id: "w1", seriesId: "s1", status: "pending", capacity: 9,
  series: { id: "s1", slug: "series-one", status: "live", archivedAt: null, zoneWorkMinutes: 6, zoneBreakMinutes: 2 },
  teams,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "hq", role: "admin", permissions: [] });
  mocks.tx.zone.count.mockResolvedValue(3);
  mocks.tx.wave.findMany.mockResolvedValue([]);
  mocks.tx.zoneScore.count.mockResolvedValue(0);
  mocks.blockers.mockResolvedValue([]);
  vi.stubEnv("EVENT_READINESS_OVERRIDE_SERIES_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("a wave with a team of one", () => {
  it("starts as before while the policy is off", async () => {
    mocks.tx.wave.findUnique.mockResolvedValue(wave([team(1, 2), team(2, 1)]));
    expect(await controlWave({ waveId: "w1", action: "start" })).toMatchObject({ ok: true });
    expect(mocks.tx.wave.update).toHaveBeenCalled();
  });

  it("is refused once the policy is on, naming the team — an unpaid team of one does not block it", async () => {
    vi.stubEnv("INCOMPLETE_TEAM_POLICY", "hold");
    mocks.tx.wave.findUnique.mockResolvedValue(wave([team(1, 2), team(12, 1), team(3, 1, { paymentStatus: "pending" })]));
    expect(await controlWave({ waveId: "w1", action: "start" })).toEqual({ ok: false, error: "INCOMPLETE_TEAM", teams: [12] });
    expect(mocks.tx.wave.update).not.toHaveBeenCalled();

    mocks.tx.wave.findUnique.mockResolvedValue(wave([team(1, 2), team(3, 1, { paymentStatus: "pending" })]));
    expect(await controlWave({ waveId: "w1", action: "start" })).toMatchObject({ ok: true });
  });
});

describe("a wave with anybody not ready", () => {
  it("is refused with the list, by team and athlete — and nothing starts", async () => {
    const blockers = [{ team: { id: "t2", number: 2, name: "TWO" }, gaps: ["warmup"], athletes: [{ id: "a", name: "Sara Ali", gaps: ["waiver"] }] }];
    mocks.blockers.mockResolvedValue(blockers);
    mocks.tx.wave.findUnique.mockResolvedValue(wave([team(1, 2), team(2, 2)]));
    expect(await controlWave({ waveId: "w1", action: "start" })).toEqual({ ok: false, error: "NOT_READY", blockers });
    expect(mocks.tx.wave.update).not.toHaveBeenCalled();
  });
});

describe("the series-scoped emergency readiness override", () => {
  const notReady = [{ team: { id: "t1", number: 1, name: "ONE" }, gaps: ["warmup"], athletes: [{ id: "a", name: "Athlete", gaps: ["account", "waiver", "entrance"] }] }];

  beforeEach(() => {
    vi.stubEnv("EVENT_READINESS_OVERRIDE_SERIES_ID", "s1");
    mocks.blockers.mockImplementation(async (_tx, _waveId, _seriesId, overridden) => overridden ? [] : notReady);
    mocks.tx.wave.findUnique.mockResolvedValue(wave([team(1, 2)]));
  });

  it("waives operational blockers for this series and records the emergency in the audit", async () => {
    expect(await controlWave({ waveId: "w1", action: "start" })).toEqual({ ok: true });
    expect(mocks.blockers).toHaveBeenCalledWith(mocks.tx, "w1", "s1", true);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining("emergency readiness override") }));
    expect(mocks.audit).not.toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining("every athlete signed") }));
  });

  it("keeps readiness required for another series", async () => {
    vi.stubEnv("EVENT_READINESS_OVERRIDE_SERIES_ID", "another-series");
    expect(await controlWave({ waveId: "w1", action: "start" })).toEqual({ ok: false, error: "NOT_READY", blockers: notReady });
    expect(mocks.blockers).toHaveBeenCalledWith(mocks.tx, "w1", "s1", false);
    expect(mocks.tx.wave.update).not.toHaveBeenCalled();
  });

  it.each([
    ["no teams", { teams: [] }, "NO_TEAMS"],
    ["missing stations", { teams: [team(1, 2, { station: null })] }, "STATIONS_MISSING"],
    ["already started", { status: "running" }, "ALREADY_STARTED"],
    ["series not live", { series: { id: "s1", status: "scheduled", archivedAt: null } }, "SERIES_NOT_LIVE"],
  ])("still refuses %s", async (_label, change, error) => {
    mocks.tx.wave.findUnique.mockResolvedValue({ ...wave([team(1, 2)]), ...change });
    expect(await controlWave({ waveId: "w1", action: "start" })).toEqual({ ok: false, error });
    expect(mocks.tx.wave.update).not.toHaveBeenCalled();
  });

  it("still refuses incomplete teams when their policy is enabled", async () => {
    vi.stubEnv("INCOMPLETE_TEAM_POLICY", "hold");
    mocks.tx.wave.findUnique.mockResolvedValue(wave([team(1, 1)]));
    expect(await controlWave({ waveId: "w1", action: "start" })).toEqual({ ok: false, error: "INCOMPLETE_TEAM", teams: [1] });
    expect(mocks.tx.wave.update).not.toHaveBeenCalled();
  });

  it("still requires zones", async () => {
    mocks.tx.zone.count.mockResolvedValue(0);
    expect(await controlWave({ waveId: "w1", action: "start" })).toEqual({ ok: false, error: "NO_ZONES" });
    expect(mocks.tx.wave.update).not.toHaveBeenCalled();
  });

  it("still prevents collision with a wave occupying Zone 1", async () => {
    mocks.tx.wave.findMany.mockResolvedValue([{ startedAt: new Date() }]);
    expect(await controlWave({ waveId: "w1", action: "start" })).toMatchObject({ ok: false, error: "ZONE_OCCUPIED" });
    expect(mocks.tx.wave.update).not.toHaveBeenCalled();
  });

  it("still protects submitted scores from a non-admin reset", async () => {
    mocks.user.mockResolvedValue({ id: "staff", role: "staff", permissions: ["waveControl.reset"] });
    mocks.tx.wave.findUnique.mockResolvedValue({ ...wave([team(1, 2)]), status: "complete" });
    mocks.tx.zoneScore.count.mockResolvedValue(1);
    expect(await controlWave({ waveId: "w1", action: "reset" })).toEqual({ ok: false, error: "WAVE_HAS_SCORES" });
    expect(mocks.tx.wave.update).not.toHaveBeenCalled();
  });
});
