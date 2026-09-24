import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(), transaction: vi.fn(), audit: vi.fn(), revalidate: vi.fn(),
  team: { findFirst: vi.fn(), updateMany: vi.fn() }, wave: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() }, request: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/session", () => ({ requireRole: mocks.actor, requireAccess: mocks.actor }));
vi.mock("@/lib/prisma", () => ({ prisma: { team: mocks.team, waveChangeRequest: mocks.request } }));
vi.mock("@/lib/wave-schedule-db", () => ({ scheduleTransaction: mocks.transaction }));
vi.mock("@/lib/audit", () => ({ AUDIT: {}, recordAudit: mocks.audit }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: mocks.revalidate }));

import { requestWaveChange, approveWaveChange, rejectWaveChange } from "@/lib/actions/wave-change-requests";

const date = new Date("2026-09-24T07:00:00.000Z");
const athlete = { id: "athlete-1", role: "competitor", permissions: ["athleteHome.view"] };
const staff = { id: "admin", role: "admin", permissions: [] };
const approval = { requestId: "request", targetWaveId: "target", teamVersion: date.toISOString(), sourceWaveId: "source",
  sourceWaveVersion: date.toISOString(), targetWaveVersion: date.toISOString(), targetOccupied: 1 };
function currentTeam(extra: Record<string, unknown> = {}) {
  return { id: "team", seriesId: "series", archivedAt: null, waitlistedAt: null, waveId: "source", updatedAt: date,
    waveRef: { id: "source", number: 1, startTime: "07:00", status: "pending", updatedAt: date },
    series: { archivedAt: null, status: "scheduled" }, ...extra };
}
function currentRequest(extra: Record<string, unknown> = {}) {
  return { id: "request", seriesId: "series", teamId: "team", status: "pending", series: { archivedAt: null, status: "scheduled" }, team: currentTeam(), ...extra };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue(staff);
  mocks.team.findFirst.mockResolvedValue(currentTeam());
  mocks.user.findUnique.mockResolvedValue({ approvalStatus: "approved" });
  mocks.request.findUnique.mockResolvedValue(currentRequest());
  mocks.request.create.mockResolvedValue({});
  mocks.request.updateMany.mockResolvedValue({ count: 1 });
  mocks.team.updateMany.mockResolvedValue({ count: 1 });
  mocks.wave.findFirst.mockResolvedValue({ id: "target", seriesId: "series", number: 2, startTime: "07:20", status: "pending", capacity: 7, updatedAt: date, teams: [{ station: 1 }] });
  mocks.transaction.mockImplementation(async (_id, work) => work({ team: mocks.team, wave: mocks.wave, user: mocks.user, waveChangeRequest: mocks.request }));
});

describe("requesting a team time change", () => {
  it.each(["athlete-1", "athlete-2"])("allows either linked athlete (%s), scoped by membership", async id => {
    mocks.actor.mockResolvedValue({ ...athlete, id });
    mocks.request.findUnique.mockResolvedValue(null);
    expect(await requestWaveChange({ teamId: "team", preference: "morning", note: "  Before noon  " })).toEqual({ ok: true });
    expect(mocks.team.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "team", archivedAt: null, competitors: { some: { userId: id } } } }));
    expect(mocks.request.create).toHaveBeenCalledWith({ data: expect.objectContaining({ openTeamId: "team", seriesId: "series", requestedById: id, preference: "morning", note: "Before noon", fromWaveNumber: 1 }) });
  });
  it("does not accept another team's id", async () => {
    mocks.actor.mockResolvedValue(athlete); mocks.team.findFirst.mockResolvedValue(null);
    expect(await requestWaveChange({ teamId: "other", preference: "midday" })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(mocks.request.create).not.toHaveBeenCalled();
  });
  it("blocks a second pending request, including one from the partner", async () => {
    mocks.actor.mockResolvedValue(athlete);
    expect(await requestWaveChange({ teamId: "team", preference: "midday" })).toEqual({ ok: false, error: "REQUEST_PENDING" });
    expect(mocks.request.create).not.toHaveBeenCalled();
  });
  it.each([{ waitlistedAt: date }, { waveRef: null }, { waveRef: { status: "running" } }, { series: { status: "final" } }])("blocks ineligible entries %j", async extra => {
    mocks.actor.mockResolvedValue(athlete); mocks.team.findFirst.mockResolvedValue(currentTeam(extra));
    expect(await requestWaveChange({ teamId: "team", preference: "evening" })).toEqual({ ok: false, error: "NOT_ELIGIBLE" });
  });
  it("rejects an unapproved account", async () => {
    mocks.actor.mockResolvedValue(athlete); mocks.user.findUnique.mockResolvedValue({ approvalStatus: "pending" });
    expect(await requestWaveChange({ teamId: "team", preference: "morning" })).toEqual({ ok: false, error: "FORBIDDEN" });
  });
});

describe("reviewing and moving atomically", () => {
  it("moves the whole team to the lowest free station and records the decision", async () => {
    expect(await approveWaveChange(approval)).toEqual({ ok: true });
    expect(mocks.team.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "team", waveId: "source", updatedAt: date }), data: { waveId: "target", wave: 2, station: 2 } });
    expect(mocks.request.updateMany).toHaveBeenCalledWith({ where: { id: "request", status: "pending" }, data: expect.objectContaining({ status: "approved", openTeamId: null, toWaveNumber: 2, toStartTime: "07:20", reviewedById: "admin" }) });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).toHaveBeenCalled();
  });
  it("rejects a full wave without approving", async () => {
    mocks.wave.findFirst.mockResolvedValue({ id: "target", status: "pending", capacity: 1, updatedAt: date, teams: [{ station: 1 }] });
    expect(await approveWaveChange(approval)).toEqual({ ok: false, error: "WAVE_FULL" });
    expect(mocks.team.updateMany).not.toHaveBeenCalled(); expect(mocks.request.updateMany).not.toHaveBeenCalled();
  });
  it("requires a refresh when another team took a place", async () => {
    expect(await approveWaveChange({ ...approval, targetOccupied: 0 })).toEqual({ ok: false, error: "SCHEDULE_CHANGED" });
    expect(mocks.team.updateMany).not.toHaveBeenCalled();
  });
  it.each(["running", "complete"])("refuses a %s target", async status => {
    mocks.wave.findFirst.mockResolvedValue({ status });
    expect(await approveWaveChange(approval)).toEqual({ ok: false, error: "WAVE_STARTED" });
    expect(mocks.team.updateMany).not.toHaveBeenCalled();
  });
  it("refuses cross-competition targets", async () => {
    mocks.wave.findFirst.mockResolvedValue(null);
    expect(await approveWaveChange(approval)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(mocks.wave.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "target", seriesId: "series" } }));
  });
  it("refuses a changed source team or source time", async () => {
    expect(await approveWaveChange({ ...approval, teamVersion: new Date(0).toISOString() })).toEqual({ ok: false, error: "SCHEDULE_CHANGED" });
    expect(await approveWaveChange({ ...approval, sourceWaveVersion: new Date(0).toISOString() })).toEqual({ ok: false, error: "SCHEDULE_CHANGED" });
  });
  it("refuses a request already decided by another reviewer", async () => {
    mocks.request.findUnique.mockResolvedValue(currentRequest({ status: "approved" }));
    expect(await approveWaveChange(approval)).toEqual({ ok: false, error: "SCHEDULE_CHANGED" });
    expect(mocks.team.updateMany).not.toHaveBeenCalled();
  });
  it("propagates a station collision out of the transaction so it rolls back", async () => {
    mocks.team.updateMany.mockRejectedValue({ code: "P2002" });
    expect(await approveWaveChange(approval)).toEqual({ ok: false, error: "SCHEDULE_CHANGED" });
    expect(mocks.request.updateMany).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("throws on a lost decision race after moving, rolling back that move", async () => {
    mocks.request.updateMany.mockResolvedValue({ count: 0 });
    expect(await approveWaveChange(approval)).toEqual({ ok: false, error: "SCHEDULE_CHANGED" });
    await expect(mocks.transaction.mock.results[0].value).rejects.toThrow("SCHEDULE_CHANGED");
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects with a reason and leaves the team's assignment alone", async () => {
    expect(await rejectWaveChange({ requestId: "request", reason: "No morning spaces" })).toEqual({ ok: true });
    expect(mocks.request.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "rejected", openTeamId: null, rejectionReason: "No morning spaces" }) }));
    expect(mocks.team.updateMany).not.toHaveBeenCalled();
    expect(await rejectWaveChange({ requestId: "request", reason: " " })).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
  it.each([
    { ...staff, viewAs: { byAdminId: "other" } },
    { id: "studio", role: "studio", permissions: ["approvals.view", "approvals.decide", "waves.placeTeams"] },
    { id: "staff", role: "staff", permissions: ["approvals.view", "approvals.decide"] },
  ])("blocks unauthorised decisions %j", async actor => {
    mocks.actor.mockResolvedValue(actor);
    expect(await approveWaveChange(approval)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await rejectWaveChange({ requestId: "request", reason: "No" })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("blocks submissions in preview mode", async () => {
    mocks.actor.mockResolvedValue({ ...athlete, viewAs: { byAdminId: "admin" } });
    expect(await requestWaveChange({ teamId: "team", preference: "morning" })).toEqual({ ok: false, error: "FORBIDDEN" });
  });
});
