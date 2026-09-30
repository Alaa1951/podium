/**
 * The buttons of the desks as server actions: the session, the input's shape,
 * and what happens after the write — one audit line per real change, none for
 * a repeat. Who may and whose teams are decided below them (bracket-change.ts,
 * checkin-db.ts) and tested there against the shipped roles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  changeBracket: vi.fn(),
  setTeamArrival: vi.fn(),
  setAthleteArrival: vi.fn(),
  setWarmupReady: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { marker: "prisma" } }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.user, requireAccess: vi.fn() }));
vi.mock("@/lib/bracket-change", () => ({ changeBracket: mocks.changeBracket }));
vi.mock("@/lib/checkin-db", () => ({ setTeamArrival: mocks.setTeamArrival, setAthleteArrival: mocks.setAthleteArrival, setWarmupReady: mocks.setWarmupReady }));
vi.mock("@/lib/audit", () => ({
  recordAudit: mocks.audit,
  AUDIT: { attendanceChanged: "registration.attendance_changed", warmupChanged: "registration.warmup_changed", paymentChanged: "registration.payment_changed" },
}));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: mocks.revalidate }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const { assistBracketChange, changeMyBracket } = await import("@/lib/actions/bracket");
const { setAthleteAttendance, setWarmupReadiness } = await import("@/lib/actions/checkin");
const { setAttendance } = await import("@/lib/actions/payments");

const athlete = { id: "u-sara", role: "competitor", studioId: null, permissions: ["athleteHome.editTeam"] };
const organiser = { id: "u-org", role: "organiser", studioId: null, permissions: ["registrations.bracket", "registrations.attendance", "checkIn.warmup"] };
const previewing = { ...organiser, viewAs: { byAdminId: "u-hq" } };
const bracket = { teamId: "t1", category: "Womens", division: "Rookie", expectedCategory: "Mixed", expectedDivision: "Open" };
const changed = { ok: true, changed: true, team: { id: "t1", label: "7 FALCONS" }, detail: "checked in (2 of 2 athletes)" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue(organiser);
  mocks.changeBracket.mockResolvedValue({ ok: true, changed: true, category: "Womens", division: "Rookie" });
});

describe("the athlete's button — change my category or level", () => {
  it("passes the athlete's own change through, and refreshes their page", async () => {
    mocks.user.mockResolvedValue(athlete);
    expect(await changeMyBracket(bracket)).toEqual({ ok: true, changed: true, category: "Womens", division: "Rookie" });
    expect(mocks.changeBracket).toHaveBeenCalledWith({ marker: "prisma" }, athlete, {
      by: "athlete", teamId: "t1", category: "Womens", division: "Rookie", expected: { category: "Mixed", division: "Open" },
    });
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/me");
  });

  it("is for an athlete's account only — not staff, not a preview, not a signed-out request", async () => {
    expect(await changeMyBracket(bracket)).toEqual({ ok: false, error: "FORBIDDEN" }); // an organiser
    mocks.user.mockResolvedValue({ ...athlete, viewAs: { byAdminId: "u-hq" } });
    expect(await changeMyBracket(bracket)).toEqual({ ok: false, error: "FORBIDDEN" });
    mocks.user.mockResolvedValue(null);
    expect(await changeMyBracket(bracket)).toEqual({ ok: false, error: "UNAUTHENTICATED" });
    expect(mocks.changeBracket).not.toHaveBeenCalled();
  });

  it("refuses anything that is not one of the competition's categories and levels", async () => {
    mocks.user.mockResolvedValue(athlete);
    for (const bad of [{ ...bracket, category: "Juniors" }, { ...bracket, division: "Elite" }, { ...bracket, teamId: "" }, null, "t1"]) {
      expect(await changeMyBracket(bad)).toEqual({ ok: false, error: "INVALID_INPUT" });
    }
    expect(mocks.changeBracket).not.toHaveBeenCalled();
  });

  it("hands back the rule's own answer, and refreshes nothing when nothing changed", async () => {
    mocks.user.mockResolvedValue(athlete);
    mocks.changeBracket.mockResolvedValue({ ok: false, error: "WAVE_STARTED" });
    expect(await changeMyBracket(bracket)).toEqual({ ok: false, error: "WAVE_STARTED" });
    mocks.changeBracket.mockResolvedValue({ ok: true, changed: false, category: "Womens", division: "Rookie" });
    expect(await changeMyBracket(bracket)).toMatchObject({ ok: true, changed: false });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe("the staff button — change it for the athlete", () => {
  it("carries the confirmation exactly as the form sent it", async () => {
    await assistBracketChange({ ...bracket, athleteApproved: true });
    expect(mocks.changeBracket).toHaveBeenCalledWith({ marker: "prisma" }, organiser, expect.objectContaining({ by: "staff", athleteApproved: true }));
    await assistBracketChange({ ...bracket, athleteApproved: false });
    expect(mocks.changeBracket).toHaveBeenLastCalledWith({ marker: "prisma" }, organiser, expect.objectContaining({ by: "staff", athleteApproved: false }));
  });

  it("refuses a request with no confirmation field, a preview, and a signed-out request", async () => {
    expect(await assistBracketChange(bracket)).toEqual({ ok: false, error: "INVALID_INPUT" });
    mocks.user.mockResolvedValue(previewing);
    expect(await assistBracketChange({ ...bracket, athleteApproved: true })).toEqual({ ok: false, error: "FORBIDDEN" });
    mocks.user.mockResolvedValue(null);
    expect(await assistBracketChange({ ...bracket, athleteApproved: true })).toEqual({ ok: false, error: "UNAUTHENTICATED" });
    expect(mocks.changeBracket).not.toHaveBeenCalled();
  });
});

describe("the check-in buttons", () => {
  it("check in a whole team: one audit line for a real change", async () => {
    mocks.setTeamArrival.mockResolvedValue(changed);
    expect(await setAttendance({ teamId: "t1", attended: true })).toEqual({ ok: true });
    expect(mocks.setTeamArrival).toHaveBeenCalledWith({ marker: "prisma" }, organiser, { teamId: "t1", attended: true });
    expect(mocks.audit).toHaveBeenCalledWith({
      actorId: "u-org", action: "registration.attendance_changed", targetType: "team", targetId: "t1", targetLabel: "7 FALCONS", detail: "checked in (2 of 2 athletes)",
    });
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
  });

  it("a repeated press is answered ok, with no second audit line and nothing refreshed", async () => {
    const repeat = { ...changed, changed: false, detail: "" };
    mocks.setTeamArrival.mockResolvedValue(repeat);
    mocks.setAthleteArrival.mockResolvedValue(repeat);
    mocks.setWarmupReady.mockResolvedValue(repeat);
    expect(await setAttendance({ teamId: "t1", attended: true })).toEqual({ ok: true });
    expect(await setAthleteAttendance({ competitorId: "seat-mona", attended: true })).toEqual({ ok: true });
    expect(await setWarmupReadiness({ teamId: "t1", ready: true })).toEqual({ ok: true });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("check in one athlete, and mark a team ready — each audited under its own action", async () => {
    mocks.setAthleteArrival.mockResolvedValue({ ...changed, detail: "Mona Saleh checked in" });
    mocks.setWarmupReady.mockResolvedValue({ ...changed, detail: "ready to compete (warm-up)" });
    expect(await setAthleteAttendance({ competitorId: "seat-mona", attended: true })).toEqual({ ok: true });
    expect(await setWarmupReadiness({ teamId: "t1", ready: true })).toEqual({ ok: true });
    expect(mocks.setAthleteArrival).toHaveBeenCalledWith({ marker: "prisma" }, organiser, { competitorId: "seat-mona", attended: true });
    expect(mocks.setWarmupReady).toHaveBeenCalledWith({ marker: "prisma" }, organiser, { teamId: "t1", ready: true });
    expect(mocks.audit.mock.calls.map(([entry]) => [entry.action, entry.detail])).toEqual([
      ["registration.attendance_changed", "Mona Saleh checked in"],
      ["registration.warmup_changed", "ready to compete (warm-up)"],
    ]);
  });

  it("hand back a refusal as it is — a judge's FORBIDDEN, a team out of scope", async () => {
    mocks.setTeamArrival.mockResolvedValue({ ok: false, error: "FORBIDDEN" });
    mocks.setAthleteArrival.mockResolvedValue({ ok: false, error: "NOT_FOUND" });
    mocks.setWarmupReady.mockResolvedValue({ ok: false, error: "SERIES_FINISHED" });
    expect(await setAttendance({ teamId: "t1", attended: true })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await setAthleteAttendance({ competitorId: "x", attended: true })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await setWarmupReadiness({ teamId: "t1", ready: true })).toEqual({ ok: false, error: "SERIES_FINISHED" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("refuse a preview, a signed-out request and a malformed one before anything is written", async () => {
    for (const action of [() => setAttendance({ teamId: "t1", attended: true }), () => setAthleteAttendance({ competitorId: "s", attended: true }), () => setWarmupReadiness({ teamId: "t1", ready: true })]) {
      mocks.user.mockResolvedValue(previewing);
      expect(await action()).toEqual({ ok: false, error: "FORBIDDEN" });
      mocks.user.mockResolvedValue(null);
      expect(await action()).toEqual({ ok: false, error: "UNAUTHENTICATED" });
    }
    mocks.user.mockResolvedValue(organiser);
    expect(await setAttendance({ teamId: "t1" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await setAthleteAttendance({ competitorId: "", attended: true })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await setWarmupReadiness({ teamId: "t1", ready: "yes" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(mocks.setTeamArrival).not.toHaveBeenCalled();
    expect(mocks.setAthleteArrival).not.toHaveBeenCalled();
    expect(mocks.setWarmupReady).not.toHaveBeenCalled();
  });
});
