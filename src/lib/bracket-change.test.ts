/**
 * Changing a team's category or level: who may, for which team, when, and
 * what is — and is not — written. The roles are the shipped ones, resolved
 * the way a real account's are, so "a judge cannot" is tested against the
 * Judge role and not against an empty list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    team: { findFirst: vi.fn(), update: vi.fn() },
    seriesParticipant: { updateMany: vi.fn() },
  };
  return { tx, locate: vi.fn(), audit: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ recordAuditIn: mocks.audit, AUDIT: { bracketChanged: "registration.bracket_changed" } }));
vi.mock("@/lib/auth-proof", () => ({ PROOF_TX: {} }));

import { changeBracket, type BracketActor, type BracketInput } from "@/lib/bracket-change";
import { resolveEffectivePermissions } from "@/lib/permissions/resolve";
import { systemRole, type AccountType } from "@/lib/permissions/system-roles";

const db = { team: { findFirst: mocks.locate }, $transaction: (work: (tx: typeof mocks.tx) => unknown) => work(mocks.tx) } as never;

/** An account holding shipped roles, with the permissions it really resolves to. */
function account(id: string, accountType: AccountType, roles: string[], studioId: string | null = null): BracketActor {
  return {
    id,
    role: accountType,
    studioId,
    permissions: resolveEffectivePermissions({ accountType, approved: true, roles: roles.map((key) => systemRole(key)!), overrides: null }),
  };
}
const sara = account("u-sara", "competitor", ["athlete"]);
const organiser = account("u-org", "organiser", ["organiser"]);
const volunteer = account("u-vol", "organiser", ["volunteer"]);
const gym = account("u-gym", "studio", ["gym-studio"], "studio-a");
const partial = account("u-desk", "staff", ["bft-partial"]);
const admin: BracketActor = { id: "u-hq", role: "admin", studioId: null, permissions: ["*"] };
const judge = account("u-judge", "organiser", ["judge"]);
const coach = account("u-coach", "organiser", ["coach"]);

/** The competition starts here; its cutoff for the team's side is the default 24 hours before. */
const START = new Date("2026-10-10T06:00:00Z");
const HOUR = 3_600_000;
const before = (hours: number) => new Date(START.getTime() - hours * HOUR);
const series = (over: object = {}) => ({ status: "scheduled", archivedAt: null, competitionDate: START, teamEditCloseHours: 24, ...over });
/** Well before the cutoff — the moment every test runs at unless it says otherwise. */
const EARLY = before(10 * 24);

/** FALCONS: Mixed · Open, Sara (f) and Omar (m) both signed in, not in a wave. */
const team = (over: object = {}) => ({
  id: "t1", seriesId: "s1", number: 7, name: "FALCONS", category: "Mixed", division: "Open", archivedAt: null, waveId: null,
  waveRef: null, score: null, series: series(),
  competitors: [
    { userId: "u-sara", user: { athleteProfile: { sex: "f" } } },
    { userId: "u-omar", user: { athleteProfile: { sex: "m" } } },
  ],
  ...over,
});
const women = { competitors: [{ userId: "u-sara", user: { athleteProfile: { sex: "f" } } }, { userId: null, user: null }] };

const mine = (over: Partial<BracketInput> = {}): BracketInput =>
  ({ by: "athlete", teamId: "t1", category: "Mixed", division: "Rookie", expected: { category: "Mixed", division: "Open" }, ...over }) as BracketInput;
const assisted = (over: Partial<BracketInput> = {}): BracketInput =>
  ({ by: "staff", athleteApproved: true, teamId: "t1", category: "Mixed", division: "Rookie", expected: { category: "Mixed", division: "Open" }, ...over }) as BracketInput;

beforeEach(() => {
  // The clock every request reads unless it passes its own: well before the cutoff.
  vi.useFakeTimers({ now: EARLY, toFake: ["Date"] });
  vi.resetAllMocks();
  mocks.locate.mockResolvedValue({ seriesId: "s1" });
  mocks.tx.team.findFirst.mockImplementation(async () => team());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("an athlete changes their own team", () => {
  it("moves Open → Rookie, and back again — both directions", async () => {
    expect(await changeBracket(db, sara, mine())).toEqual({ ok: true, changed: true, category: "Mixed", division: "Rookie" });
    expect(mocks.tx.team.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { category: "Mixed", division: "Rookie" } });

    mocks.tx.team.findFirst.mockResolvedValue(team({ division: "Rookie" }));
    expect(await changeBracket(db, sara, mine({ division: "Open", expected: { category: "Mixed", division: "Rookie" } }))).toMatchObject({ ok: true, changed: true, division: "Open" });
  });

  it("changes the category — to Womens when the pair can enter it, and to Mixed from anywhere", async () => {
    mocks.tx.team.findFirst.mockResolvedValue(team(women));
    expect(await changeBracket(db, sara, mine({ category: "Womens", division: "Open" }))).toMatchObject({ ok: true, changed: true, category: "Womens" });
    mocks.tx.team.findFirst.mockResolvedValue(team({ ...women, category: "Womens" }));
    expect(await changeBracket(db, sara, mine({ category: "Mixed", division: "Open", expected: { category: "Womens", division: "Open" } }))).toMatchObject({ ok: true, category: "Mixed" });
  });

  it("writes the TEAM's bracket and each signed-in member's entry — and nothing else", async () => {
    await changeBracket(db, sara, mine({ division: "Rookie" }));
    // Exactly the two columns: no check-in, no warm-up, no wave, no station, no payment.
    expect(Object.keys(mocks.tx.team.update.mock.calls[0][0].data).sort()).toEqual(["category", "division"]);
    expect(mocks.tx.seriesParticipant.updateMany).toHaveBeenCalledWith({
      where: { seriesId: "s1", userId: { in: ["u-sara", "u-omar"] } },
      data: { category: "Mixed", division: "Rookie" },
    });
  });

  it("records who, which team, from what to what, and that the athlete did it", async () => {
    await changeBracket(db, sara, mine({ category: "Mixed", division: "Rookie" }));
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, {
      actorId: "u-sara", action: "registration.bracket_changed", targetType: "team", targetId: "t1", targetLabel: "7 FALCONS",
      detail: "category Mixed (unchanged) · level Open → Rookie · changed by the athlete, on their own team",
    });
  });

  it("reaches only a team they sit on", async () => {
    await changeBracket(db, sara, mine());
    const scoped = { id: "t1", archivedAt: null, competitors: { some: { userId: "u-sara" } } };
    expect(mocks.locate.mock.calls[0][0].where).toEqual(scoped);
    expect(mocks.tx.team.findFirst.mock.calls[0][0].where).toEqual(scoped);
    mocks.locate.mockResolvedValue(null);
    mocks.tx.team.update.mockClear();
    expect(await changeBracket(db, sara, mine({ teamId: "someone-elses" }))).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(mocks.tx.team.update).not.toHaveBeenCalled();
  });

  it("needs the athlete's own key, and is never open to a staff account pretending to be the athlete", async () => {
    expect(await changeBracket(db, { ...sara, permissions: [] }, mine())).toEqual({ ok: false, error: "FORBIDDEN" });
    for (const actor of [organiser, volunteer, gym, judge, admin]) {
      expect(await changeBracket(db, actor, mine())).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(mocks.locate).not.toHaveBeenCalled();
  });
});

describe("staff change it for an athlete who asked", () => {
  it.each([
    ["an Organiser", organiser],
    ["a Volunteer", volunteer],
    ["a Gym / Studio account", gym],
    ["BFT MENA Partial", partial],
    ["BFT MENA Full", admin],
  ])("%s may, once the athlete's request and approval are confirmed", async (_label, actor) => {
    expect(await changeBracket(db, actor, assisted())).toMatchObject({ ok: true, changed: true, division: "Rookie" });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      actorId: actor.id, action: "registration.bracket_changed", targetId: "t1",
      detail: "category Mixed (unchanged) · level Open → Rookie · staff-assisted: confirmed that the athlete asked for this change and approves it",
    }));
  });

  it("refuses to save without the confirmation — before anything is read", async () => {
    expect(await changeBracket(db, organiser, assisted({ athleteApproved: false } as never))).toEqual({ ok: false, error: "APPROVAL_REQUIRED" });
    expect(await changeBracket(db, organiser, { ...assisted(), athleteApproved: undefined } as never)).toEqual({ ok: false, error: "APPROVAL_REQUIRED" });
    expect(mocks.locate).not.toHaveBeenCalled();
    expect(mocks.tx.team.update).not.toHaveBeenCalled();
  });

  it("refuses a Judge, a Coach, and an athlete's account — whatever they send", async () => {
    for (const actor of [judge, coach, sara, { ...sara, permissions: [...sara.permissions, "registrations.bracket"] }]) {
      expect(await changeBracket(db, actor, assisted())).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(mocks.locate).not.toHaveBeenCalled();
  });

  it("refuses an organiser whose key was taken away, and one locked out of it", async () => {
    const without = { ...organiser, permissions: organiser.permissions.filter((key) => key !== "registrations.bracket") };
    expect(await changeBracket(db, without, assisted())).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("keeps a gym to its own teams: another gym's team does not exist for it", async () => {
    await changeBracket(db, gym, assisted());
    expect(mocks.locate.mock.calls[0][0].where).toEqual({ id: "t1", archivedAt: null, studioId: "studio-a" });
    expect(mocks.tx.team.findFirst.mock.calls[0][0].where).toEqual({ id: "t1", archivedAt: null, studioId: "studio-a" });
    mocks.locate.mockResolvedValue(null);
    expect(await changeBracket(db, gym, assisted({ teamId: "rival-team" }))).toEqual({ ok: false, error: "NOT_FOUND" });
    // A gym account with no gym matches nothing at all.
    await changeBracket(db, { ...gym, studioId: null }, assisted());
    expect(mocks.locate.mock.calls.at(-1)![0].where).toMatchObject({ studioId: "__none__" });
  });
});

describe("the rules every change meets", () => {
  it("keeps a man out of Womens and a woman out of Mens", async () => {
    expect(await changeBracket(db, sara, mine({ category: "Womens", division: "Open" }))).toEqual({ ok: false, error: "WOMENS_HAS_A_MAN" });
    expect(await changeBracket(db, organiser, assisted({ category: "Mens", division: "Open" }))).toEqual({ ok: false, error: "MENS_HAS_A_WOMAN" });
    expect(mocks.tx.team.update).not.toHaveBeenCalled();
  });

  it("leaves Pro to BFT MENA: not the athlete, a gym, an organiser or a volunteer", async () => {
    for (const [actor, input] of [[sara, mine({ division: "Pro" })], [gym, assisted({ division: "Pro" })], [organiser, assisted({ division: "Pro" })], [volunteer, assisted({ division: "Pro" })]] as const) {
      expect(await changeBracket(db, actor, input)).toEqual({ ok: false, error: "PRO_IS_BFT_MENA" });
    }
    mocks.tx.team.findFirst.mockResolvedValue(team({ division: "Pro" }));
    expect(await changeBracket(db, sara, mine({ division: "Open", expected: { category: "Mixed", division: "Pro" } }))).toEqual({ ok: false, error: "PRO_IS_BFT_MENA" });
    expect(mocks.tx.team.update).not.toHaveBeenCalled();
    mocks.tx.team.findFirst.mockResolvedValue(team());
    expect(await changeBracket(db, partial, assisted({ division: "Pro" }))).toMatchObject({ ok: true, division: "Pro" });
    expect(await changeBracket(db, admin, assisted({ division: "Pro" }))).toMatchObject({ ok: true, division: "Pro" });
  });

  it("keeps a team placed in a wave that has not started — and its wave and station with it", async () => {
    mocks.tx.team.findFirst.mockResolvedValue(team({ waveId: "w1", waveRef: { status: "pending" } }));
    expect(await changeBracket(db, sara, mine())).toMatchObject({ ok: true, changed: true });
    expect(mocks.tx.team.update.mock.calls[0][0].data).toEqual({ category: "Mixed", division: "Rookie" });
  });

  it.each([
    ["it has a score", { score: { id: "sc1" } }, "TEAM_ALREADY_SCORED"],
    ["the competition is finished", { series: series({ status: "final" }) }, "SERIES_FINISHED"],
  ])("stops everybody — Full access too — once %s", async (_label, over, error) => {
    mocks.tx.team.findFirst.mockResolvedValue(team(over));
    expect(await changeBracket(db, sara, mine())).toEqual({ ok: false, error });
    for (const actor of [gym, volunteer, organiser, partial, admin]) {
      expect(await changeBracket(db, actor, assisted())).toEqual({ ok: false, error });
    }
    expect(mocks.tx.team.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("when — the team's side has a cutoff, the floor's side has the score", () => {
  it.each([
    ["one second before the cutoff", new Date(before(24).getTime() - 1_000), { ok: true, changed: true }],
    ["exactly at the cutoff", before(24), { ok: false, error: "TEAM_EDIT_CLOSED" }],
    ["an hour before the start", before(1), { ok: false, error: "TEAM_EDIT_CLOSED" }],
  ])("an athlete, and their gym: %s", async (_label, now, expected) => {
    expect(await changeBracket(db, sara, mine(), now)).toMatchObject(expected);
    mocks.tx.team.findFirst.mockResolvedValue(team());
    expect(await changeBracket(db, gym, assisted(), now)).toMatchObject(expected);
  });

  it("the cutoff is the competition's own setting, not a fixed 24 hours", async () => {
    // Settings → Team changes: 2 hours. Three hours before the start is still open.
    mocks.tx.team.findFirst.mockResolvedValue(team({ series: series({ teamEditCloseHours: 2 }) }));
    expect(await changeBracket(db, sara, mine(), before(3))).toMatchObject({ ok: true, changed: true });
    mocks.tx.team.findFirst.mockResolvedValue(team({ series: series({ teamEditCloseHours: 2 }) }));
    expect(await changeBracket(db, sara, mine(), before(1))).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
    // 48 hours: closed a day and a half out, when the default would still be open.
    mocks.tx.team.findFirst.mockResolvedValue(team({ series: series({ teamEditCloseHours: 48 }) }));
    expect(await changeBracket(db, sara, mine(), before(36))).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
  });

  it.each([
    ["BFT MENA Full", admin],
    ["BFT MENA Partial", partial],
    ["an Organiser", organiser],
    ["a Volunteer at the desk", volunteer],
  ])("%s may still change it after the cutoff — minutes before the start, and with the wave already called", async (_label, actor) => {
    expect(await changeBracket(db, actor, assisted(), new Date(START.getTime() - 5 * 60_000))).toMatchObject({ ok: true, changed: true });
    mocks.tx.team.findFirst.mockResolvedValue(team({ series: series({ status: "live" }), waveId: "w1", waveRef: { status: "running" } }));
    expect(await changeBracket(db, actor, assisted(), new Date(START.getTime() + 10 * 60_000))).toMatchObject({ ok: true, changed: true });
    // …until a score is entered for the team.
    mocks.tx.team.findFirst.mockResolvedValue(team({ series: series({ status: "live" }), waveId: "w1", waveRef: { status: "running" }, score: { id: "sc1" } }));
    expect(await changeBracket(db, actor, assisted(), new Date(START.getTime() + 10 * 60_000))).toEqual({ ok: false, error: "TEAM_ALREADY_SCORED" });
  });

  it("an athlete and their gym never change it once the wave has started, whatever the clock says", async () => {
    for (const status of ["running", "complete"]) {
      mocks.tx.team.findFirst.mockResolvedValue(team({ waveId: "w1", waveRef: { status } }));
      expect(await changeBracket(db, sara, mine())).toEqual({ ok: false, error: "WAVE_STARTED" });
      expect(await changeBracket(db, gym, assisted())).toEqual({ ok: false, error: "WAVE_STARTED" });
    }
    expect(mocks.tx.team.update).not.toHaveBeenCalled();
  });
});

describe("two requests, one team", () => {

  it("refuses a page showing a bracket the team no longer has", async () => {
    mocks.tx.team.findFirst.mockResolvedValue(team({ category: "Womens", division: "Open" }));
    expect(await changeBracket(db, sara, mine({ division: "Rookie", expected: { category: "Mixed", division: "Open" } }))).toEqual({ ok: false, error: "STALE_BRACKET" });
    expect(mocks.tx.team.update).not.toHaveBeenCalled();
  });

  it("is safe to send twice: the second request finds it done, writes nothing and audits nothing", async () => {
    expect(await changeBracket(db, sara, mine())).toMatchObject({ ok: true, changed: true });
    mocks.tx.team.findFirst.mockResolvedValue(team({ division: "Rookie" }));
    expect(await changeBracket(db, sara, mine())).toEqual({ ok: true, changed: false, category: "Mixed", division: "Rookie" });
    expect(mocks.tx.team.update).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("does not change a team without its audit line", async () => {
    mocks.audit.mockRejectedValue(new Error("audit down"));
    await expect(changeBracket(db, sara, mine())).rejects.toThrow("audit down");
  });

  it("decides under the competition lock, on the team as re-read there", async () => {
    await changeBracket(db, sara, mine());
    expect(mocks.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.team.findFirst.mock.invocationCallOrder[0]);
  });
});
