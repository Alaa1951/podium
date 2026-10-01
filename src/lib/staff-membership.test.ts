/**
 * Staff and gyms changing a team — the rules, decided after the competition
 * lock on the team as re-read there (staff-membership.ts). The effects on
 * links and partners are proven on a real database
 * (membership.integration.test.ts); here, who may do what, and when.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    competitor: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    competitorPortrait: { deleteMany: vi.fn() },
    portraitJob: { deleteMany: vi.fn() },
    team: { findFirst: vi.fn(), update: vi.fn() },
    seriesParticipant: { updateMany: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
  };
  return { tx, entry: vi.fn(), sync: vi.fn(), reconcile: vi.fn(), audit: vi.fn(), participation: vi.fn(), forget: vi.fn() };
});
vi.mock("@/lib/auth-proof", () => ({ PROOF_TX: {}, forgetAddressProof: mocks.forget }));
vi.mock("@/lib/audit", () => ({ recordAuditIn: mocks.audit, AUDIT: { teamMemberSwapped: "swap", teamOwnershipChanged: "ownership", registrationUpdated: "updated", accountUpdated: "account" } }));
vi.mock("@/lib/membership-sync", () => ({ syncAfterMembershipChange: mocks.sync, reconcileDerivedLinks: mocks.reconcile }));
vi.mock("@/lib/one-entry", () => ({ findEntryInSeries: mocks.entry }));
vi.mock("@/lib/participation", () => ({ ensureParticipation: mocks.participation }));
vi.mock("@/lib/scoring", () => ({ normalizeName: (n: string) => n.trim().toLowerCase() }));

import { correctSeat, editRegistration, swapSeat } from "@/lib/staff-membership";

const db = { competitor: { findFirst: vi.fn() }, team: { findFirst: vi.fn() }, $transaction: vi.fn() };
/** BFT MENA Full access: the account type that passes every check. */
const full = { id: "hq", role: "admin" as const, studioId: null, permissions: [] as never[] };
/** BFT MENA Partial access, holding every registrations key it can be given. */
const partial = { id: "desk", role: "staff" as const, studioId: null, permissions: ["registrations.edit", "registrations.pair"] as never[] };
const gym = { id: "gym", role: "studio" as const, studioId: "studio-a", permissions: ["registrations.edit", "registrations.pair"] as never[] };

const START = new Date("2026-10-02T15:00:00Z");
const CUTOFF = new Date("2026-10-01T15:00:00Z");
const before = new Date(CUTOFF.getTime() - 1);
const after = new Date(CUTOFF.getTime() + 3_600_000);

/** Sara (seat 2, signed in) registered FALCONS; Mona (seat 1) has not signed in. */
function team(over: object = {}) {
  return {
    id: "t1", seriesId: "s1", number: 7, name: "FALCONS", archivedAt: null, waveId: null, membershipVersion: 4, category: "Womens", division: "Open",
    ownership: "registrant", registrantEmail: "sara@example.com", registrantUserId: "u-sara",
    waveRef: null, score: null, series: { status: "scheduled", archivedAt: null, registrationClosesAt: null, competitionDate: START },
    competitors: [
      { id: "seat-mona", position: 1, userId: null, email: "mona@example.com", fullName: "Mona Saleh", phone: "+97450000001", dateOfBirth: null, studioId: null, user: null },
      { id: "seat-sara", position: 2, userId: "u-sara", email: "sara@example.com", fullName: "Sara Ali", phone: null, dateOfBirth: null, studioId: null, user: { email: "sara@example.com", name: "Sara Ali" } },
    ],
    ...over,
  };
}
const seatOf = (id: string, t = team()) => ({ ...t.competitors.find((one) => one.id === id)!, team: t });

beforeEach(() => {
  vi.clearAllMocks();
  db.competitor.findFirst.mockResolvedValue({ team: { seriesId: "s1" } });
  db.team.findFirst.mockResolvedValue({ seriesId: "s1" });
  db.$transaction.mockImplementation(async (work: (tx: typeof mocks.tx) => unknown) => work(mocks.tx));
  mocks.entry.mockResolvedValue(null);
  mocks.audit.mockResolvedValue(undefined);
  mocks.tx.competitor.findFirst.mockResolvedValue(seatOf("seat-mona"));
  mocks.tx.team.findFirst.mockResolvedValue(team());
});

const swapIn = { competitorId: "seat-mona", fullName: "Nour Hassan", email: "nour@example.com" };
const form = (mona: object = {}, sara: object = {}, over: object = {}) => ({
  teamId: "t1", teamName: "Falcons", category: "Womens" as const, division: "Open" as const,
  one: { id: "seat-mona", fullName: "Mona Saleh", email: "mona@example.com", phone: "+97450000001", dateOfBirth: null, studioId: null, ...mona },
  two: { id: "seat-sara", fullName: "Sara Ali", email: "sara@example.com", phone: null, dateOfBirth: null, studioId: null, ...sara },
  ...over,
});

describe("the 24-hour cutoff (D3a) — every staff entry point", () => {
  it.each([
    ["a gym", gym],
    ["BFT MENA Partial access", partial],
    ["BFT MENA Full access", full],
  ])("%s may swap and edit before the cutoff", async (_label, actor) => {
    expect(await swapSeat(db as never, actor, swapIn, before)).toMatchObject({ ok: true });
    expect(await editRegistration(db as never, actor, form({ fullName: "Mona A. Saleh" }), before)).toEqual({ ok: true });
  });

  it.each([
    ["a gym", gym],
    ["BFT MENA Partial access", partial],
  ])("%s is closed AT the cutoff and after — swap, add, email change and even a name fix", async (_label, actor) => {
    for (const now of [CUTOFF, after]) {
      expect(await swapSeat(db as never, actor, swapIn, now)).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
      expect(await editRegistration(db as never, actor, form({ fullName: "Mona A. Saleh" }), now)).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
      expect(await editRegistration(db as never, actor, form({ email: "mona.s@example.com" }), now)).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
    }
    expect(mocks.tx.competitor.update).not.toHaveBeenCalled();
    expect(mocks.tx.competitor.create).not.toHaveBeenCalled();
  });

  it("a Partial-access account holding every grantable key is still not Full access", async () => {
    const loaded = { ...partial, permissions: ["registrations.edit", "registrations.pair", "registrations.create", "registrations.archive"] as never[] };
    expect(await swapSeat(db as never, loaded, swapIn, after)).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
  });

  it("BFT MENA Full access may still swap and edit after the cutoff", async () => {
    expect(await swapSeat(db as never, full, swapIn, after)).toMatchObject({ ok: true, changed: true });
    expect(await editRegistration(db as never, full, form({ fullName: "Mona A. Saleh" }), after)).toEqual({ ok: true });
  });
});

describe("the floor's barriers stop a change of WHO is on the team — Full access too", () => {
  const onePlusNew = (over: object) => {
    mocks.tx.team.findFirst.mockResolvedValue(team({ competitors: [team().competitors[1]], ...over }));
    return form({}, {}, { one: { id: "seat-sara", fullName: "Sara Ali", email: "sara@example.com", phone: null, dateOfBirth: null, studioId: null }, two: { fullName: "Nour Hassan", email: "nour@example.com", phone: null, dateOfBirth: null, studioId: null } });
  };
  it.each([
    ["the competition is finished", { series: { status: "final", archivedAt: null, registrationClosesAt: null, competitionDate: START } }, "SERIES_FINISHED"],
    ["the team has a score", { score: { id: "sc" } }, "TEAM_ALREADY_SCORED"],
    ["its wave has started", { waveId: "w1", waveRef: { status: "running" } }, "WAVE_STARTED"],
  ])("adding a partner is refused when %s", async (_label, over, error) => {
    expect(await editRegistration(db as never, full, onePlusNew(over), before)).toEqual({ ok: false, error });
    expect(mocks.tx.competitor.create).not.toHaveBeenCalled();
  });

  it.each([
    ["the competition is finished", { series: { status: "final", archivedAt: null, registrationClosesAt: null, competitionDate: START } }, "SERIES_FINISHED"],
    ["the team has a score", { score: { id: "sc" } }, "TEAM_ALREADY_SCORED"],
    ["its wave has started", { waveId: "w1", waveRef: { status: "running" } }, "WAVE_STARTED"],
  ])("a new email from staff below Full access is refused when %s; a name fix still goes through", async (_label, over, error) => {
    mocks.tx.team.findFirst.mockResolvedValue(team(over));
    expect(await editRegistration(db as never, partial, form({ email: "nour@example.com" }), before)).toEqual({ ok: false, error });
    expect(await editRegistration(db as never, partial, form({ fullName: "Mona A. Saleh" }), before)).toEqual({ ok: true });
  });

  it("a swap is refused on the same barriers", async () => {
    mocks.tx.competitor.findFirst.mockResolvedValue(seatOf("seat-mona", team({ waveId: "w1", waveRef: { status: "running" } })));
    expect(await swapSeat(db as never, full, swapIn, before)).toEqual({ ok: false, error: "WAVE_STARTED" });
  });
});

describe("an email is who a seat is", () => {
  it("a new email alone — the name unchanged — is a new person: checked, the seat cleared, versioned, synced, audited", async () => {
    expect(await editRegistration(db as never, gym, form({ email: "mona.new@example.com" }), before)).toEqual({ ok: true });
    expect(mocks.entry).toHaveBeenCalledWith(expect.objectContaining({ emails: ["mona.new@example.com"], exceptCompetitorId: "seat-mona" }), mocks.tx);
    // The phone the form carried over from the previous person does not stay.
    expect(mocks.tx.competitor.update).toHaveBeenCalledWith({ where: { id: "seat-mona" }, data: expect.objectContaining({ email: "mona.new@example.com", phone: null, userId: null, photoPath: null }) });
    expect(mocks.tx.competitorPortrait.deleteMany).toHaveBeenCalledWith({ where: { competitorId: "seat-mona" } });
    expect(mocks.tx.team.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: expect.objectContaining({ membershipVersion: { increment: 1 }, groupPortraitPath: null }) });
    expect(mocks.sync).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "updated" }));
  });

  it("a signed-in seat's email never changes here for staff below Full access, or a gym", async () => {
    expect(await editRegistration(db as never, partial, form({}, { email: "sara.new@example.com" }), before)).toEqual({ ok: false, error: "LINKED_SEAT_EMAIL" });
    expect(await editRegistration(db as never, gym, form({}, { email: "sara.new@example.com" }), before)).toEqual({ ok: false, error: "LINKED_SEAT_EMAIL" });
  });

  it("an account whose email and name differ from its seat's is no change nobody typed", async () => {
    // The form shows the account (queries.ts › toRosterRow); the seat still holds what was registered.
    mocks.tx.team.findFirst.mockResolvedValue(team({ competitors: [team().competitors[0], { ...team().competitors[1], email: "old@example.com", fullName: "Sarah" }] }));
    expect(await editRegistration(db as never, partial, form({}, {}, { teamName: "Hawks" }), before)).toEqual({ ok: true });
    expect(mocks.tx.team.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: expect.objectContaining({ name: "HAWKS" }) });
    expect(mocks.tx.user.update).not.toHaveBeenCalled();
  });

  it("an address already entered in this competition is refused", async () => {
    mocks.entry.mockResolvedValue({ competitorId: "elsewhere" });
    expect(await editRegistration(db as never, full, form({ email: "taken@example.com" }), before)).toEqual({ ok: false, error: "ALREADY_ENTERED" });
  });

  it("a name fix alone is a correction: no version bump, no clearing, and the team's readiness stands", async () => {
    expect(await editRegistration(db as never, gym, form({ fullName: "Mona A. Saleh" }), before)).toEqual({ ok: true });
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.reconcile).toHaveBeenCalledWith(mocks.tx, "t1");
    expect(mocks.tx.competitorPortrait.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.team.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: expect.not.objectContaining({ membershipVersion: expect.anything() }) });
  });
});

describe("BFT MENA Full access corrects any athlete's name and email — the same athlete", () => {
  it("an email put right on a seat without an account: nothing cleared, no new version, no barrier", async () => {
    mocks.tx.team.findFirst.mockResolvedValue(team({ score: { id: "sc" }, waveId: "w1", waveRef: { status: "running" } }));
    expect(await editRegistration(db as never, full, form({ email: "mona.s@example.com" }), after)).toEqual({ ok: true });
    expect(mocks.entry).toHaveBeenCalledWith(expect.objectContaining({ emails: ["mona.s@example.com"], exceptCompetitorId: "seat-mona" }), mocks.tx);
    expect(mocks.tx.competitor.update).toHaveBeenCalledWith({ where: { id: "seat-mona" }, data: expect.objectContaining({ email: "mona.s@example.com", phone: "+97450000001" }) });
    expect(mocks.tx.competitor.update).toHaveBeenCalledWith({ where: { id: "seat-mona" }, data: expect.not.objectContaining({ userId: null }) });
    expect(mocks.tx.competitorPortrait.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.team.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: expect.not.objectContaining({ membershipVersion: expect.anything() }) });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "updated", detail: expect.stringContaining("email mona@example.com → mona.s@example.com (corrected, same athlete)") }));
  });

  it("a signed-in athlete's email only on the tick — then their sign-in email changes, old codes and links spent", async () => {
    const edit = form({}, { email: "Sara.New@example.com" });
    expect(await editRegistration(db as never, full, edit, before)).toEqual({ ok: false, error: "CONFIRM_ACCOUNT_EMAIL" });
    expect(mocks.tx.user.update).not.toHaveBeenCalled();
    expect(await editRegistration(db as never, full, { ...edit, confirmAccountEmail: true }, before)).toEqual({ ok: true });
    expect(mocks.tx.user.update).toHaveBeenCalledWith({ where: { id: "u-sara" }, data: { email: "sara.new@example.com" } });
    expect(mocks.forget).toHaveBeenCalledWith(mocks.tx, "u-sara");
    // Still the registrant: the address follows, the account link stays.
    expect(mocks.tx.team.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: expect.objectContaining({ registrantEmail: "sara.new@example.com" }) });
    expect(mocks.tx.team.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: expect.not.objectContaining({ registrantUserId: null }) });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "account", targetId: "u-sara" }));
  });

  it("never onto another account's address, never the actor's own", async () => {
    mocks.tx.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "u-other" });
    expect(await editRegistration(db as never, full, form({}, { email: "taken@example.com" }, { confirmAccountEmail: true }), before)).toEqual({ ok: false, error: "ACCOUNT_EMAIL_TAKEN" });
    const self = { ...full, id: "u-sara" };
    expect(await editRegistration(db as never, self, form({}, { email: "me@example.com" }, { confirmAccountEmail: true }), before)).toEqual({ ok: false, error: "OWN_ACCOUNT" });
  });

  it("a signed-in athlete's name is their account's name: Full access corrects it; below Full access, the seat only", async () => {
    expect(await editRegistration(db as never, full, form({}, { fullName: "Sara M. Ali" }), before)).toEqual({ ok: true });
    expect(mocks.tx.user.update).toHaveBeenCalledWith({ where: { id: "u-sara" }, data: { name: "Sara M. Ali" } });
    mocks.tx.user.update.mockClear();
    expect(await editRegistration(db as never, partial, form({}, { fullName: "Sara M. Ali" }), before)).toEqual({ ok: true });
    expect(mocks.tx.user.update).not.toHaveBeenCalled();
  });
});

describe("one athlete put right, or replaced, at the athlete's request after team changes close", () => {
  const correction = (over: object = {}) => ({ competitorId: "seat-mona", fullName: "Mona Saleh", email: "mona@example.com", phone: "+97450000001", dateOfBirth: null, ...over });
  const withSeat = (id: string, t = team()) => mocks.tx.competitor.findFirst.mockResolvedValue(seatOf(id, t));

  it("an athlete without an account: name, email and phone corrected — nothing cleared, no new version, readiness kept", async () => {
    withSeat("seat-mona");
    expect(await correctSeat(db as never, gym, correction({ fullName: "Mona A. Saleh", email: "mona.s@example.com" }), before)).toEqual({ ok: true });
    expect(mocks.tx.competitor.update).toHaveBeenCalledWith({ where: { id: "seat-mona" }, data: expect.objectContaining({ fullName: "Mona A. Saleh", email: "mona.s@example.com", phone: "+97450000001" }) });
    expect(mocks.tx.competitor.update).toHaveBeenCalledWith({ where: { id: "seat-mona" }, data: expect.not.objectContaining({ userId: null }) });
    expect(mocks.tx.team.update).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "updated", detail: expect.stringContaining("(corrected, same athlete)") }));
  });

  it("after the cutoff: refused without the athlete's request, done with it — and the audit line says so", async () => {
    withSeat("seat-mona");
    expect(await correctSeat(db as never, partial, correction({ fullName: "Mona A. Saleh" }), after)).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
    expect(await correctSeat(db as never, partial, correction({ fullName: "Mona A. Saleh", assisted: true }), after)).toEqual({ ok: true });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ detail: expect.stringContaining("staff-assisted: confirmed that the athlete asked for this change and approves it") }));
    // Full access needs no request.
    expect(await correctSeat(db as never, full, correction({ fullName: "Mona B. Saleh" }), after)).toEqual({ ok: true });
  });

  it("a signed-in athlete's name, email and phone are their account's: Full access only; anybody may fix the date of birth", async () => {
    withSeat("seat-sara");
    const sara = { competitorId: "seat-sara", fullName: "Sara Ali", email: "sara@example.com", phone: null, dateOfBirth: null };
    for (const change of [{ fullName: "Sara M. Ali" }, { email: "sara.new@example.com" }, { phone: "+97455555555" }]) {
      expect(await correctSeat(db as never, partial, { ...sara, ...change }, before)).toEqual({ ok: false, error: "ACCOUNT_DETAILS" });
    }
    expect(await correctSeat(db as never, partial, { ...sara, dateOfBirth: new Date("1996-05-01") }, before)).toEqual({ ok: true });
    expect(await correctSeat(db as never, full, { ...sara, email: "sara.new@example.com" }, before)).toEqual({ ok: false, error: "CONFIRM_ACCOUNT_EMAIL" });
    expect(await correctSeat(db as never, full, { ...sara, email: "sara.new@example.com", fullName: "Sara M. Ali", confirmAccountEmail: true }, before)).toEqual({ ok: true });
    expect(mocks.tx.user.update).toHaveBeenCalledWith({ where: { id: "u-sara" }, data: { email: "sara.new@example.com" } });
    expect(mocks.tx.user.update).toHaveBeenCalledWith({ where: { id: "u-sara" }, data: { name: "Sara M. Ali" } });
  });

  it("the registrant's email is BFT MENA's; a finished competition is Full access's record", async () => {
    const unclaimed = team({ registrantUserId: null, competitors: [team().competitors[0], { ...team().competitors[1], userId: null, user: null }] });
    withSeat("seat-sara", unclaimed);
    expect(await correctSeat(db as never, gym, { competitorId: "seat-sara", fullName: "Sara Ali", email: "sara.new@example.com", phone: null, dateOfBirth: null }, before)).toEqual({ ok: false, error: "REGISTRANT_EMAIL_LOCKED" });
    withSeat("seat-mona", team({ series: { status: "final", archivedAt: null, registrationClosesAt: null, competitionDate: START } }));
    expect(await correctSeat(db as never, partial, correction({ fullName: "Mona A. Saleh", assisted: true }), before)).toEqual({ ok: false, error: "SERIES_FINISHED" });
    expect(await correctSeat(db as never, full, correction({ fullName: "Mona A. Saleh" }), before)).toEqual({ ok: true });
  });

  it("a gym replaces its athlete's partner after the cutoff at the athlete's request — never once the wave has started", async () => {
    expect(await swapSeat(db as never, gym, swapIn, after)).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
    expect(await swapSeat(db as never, gym, { ...swapIn, assisted: true }, after)).toMatchObject({ ok: true, changed: true });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "swap", detail: expect.stringContaining("staff-assisted") }));
    mocks.tx.competitor.findFirst.mockResolvedValue(seatOf("seat-mona", team({ waveId: "w1", waveRef: { status: "running" } })));
    expect(await swapSeat(db as never, gym, { ...swapIn, assisted: true }, after)).toEqual({ ok: false, error: "WAVE_STARTED" });
  });
});

describe("a bracket corrected on the edit form", () => {
  it("says from what to what in the audit line, and the signed-in members' entries follow the team", async () => {
    expect(await editRegistration(db as never, full, { ...form(), category: "Mixed", division: "Rookie" }, before)).toEqual({ ok: true });
    expect(mocks.tx.seriesParticipant.updateMany).toHaveBeenCalledWith({
      where: { seriesId: "s1", userId: { in: ["u-sara"] } },
      data: { category: "Mixed", division: "Rookie" },
    });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      action: "updated", detail: expect.stringContaining("category Womens → Mixed · level Open → Rookie"),
    }));
  });

  it("writes neither when the bracket did not change; a gym still cannot move the level from this form", async () => {
    expect(await editRegistration(db as never, gym, form({ fullName: "Mona A. Saleh" }), before)).toEqual({ ok: true });
    expect(mocks.tx.seriesParticipant.updateMany).not.toHaveBeenCalled();
    expect(await editRegistration(db as never, gym, { ...form(), division: "Rookie" }, before)).toEqual({ ok: false, error: "DIVISION_LOCKED" });
  });
});

describe("the registrant, versions, seats", () => {
  it("the registrant's seat (seat 2): never a gym; BFT MENA only with an explicit transfer", async () => {
    mocks.tx.competitor.findFirst.mockResolvedValue(seatOf("seat-sara"));
    expect(await swapSeat(db as never, gym, { competitorId: "seat-sara", fullName: "Nour Hassan" }, before)).toEqual({ ok: false, error: "REGISTRANT_SEAT" });
    expect(await swapSeat(db as never, full, { competitorId: "seat-sara", fullName: "Nour Hassan", email: "nour@example.com" }, before)).toEqual({ ok: false, error: "TRANSFER_REQUIRED" });
    expect(await swapSeat(db as never, full, { competitorId: "seat-sara", fullName: "Nour Hassan", email: "nour@example.com", transferOwnership: true }, before)).toMatchObject({ ok: true });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "ownership" }));
  });

  it("the registrant's email on an unclaimed seat: BFT MENA only", async () => {
    mocks.tx.team.findFirst.mockResolvedValue(team({ registrantUserId: null, competitors: [
      { id: "seat-mona", position: 1, userId: "u-mona", email: "mona@example.com", fullName: "Mona Saleh", phone: null, dateOfBirth: null, studioId: null },
      { id: "seat-sara", position: 2, userId: null, email: "sara@example.com", fullName: "Sara Ali", phone: null, dateOfBirth: null, studioId: null },
    ] }));
    const move = form({}, { email: "sara.new@example.com" });
    expect(await editRegistration(db as never, gym, move, before)).toEqual({ ok: false, error: "REGISTRANT_EMAIL_LOCKED" });
    // BFT MENA below Full access: a new email is a new person, and the registrant goes with it.
    expect(await editRegistration(db as never, partial, move, before)).toEqual({ ok: true });
    expect(mocks.tx.team.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: expect.objectContaining({ registrantEmail: "sara.new@example.com", registrantUserId: null }) });
    // Full access corrects the same registrant's address.
    mocks.tx.team.update.mockClear();
    expect(await editRegistration(db as never, full, move, before)).toEqual({ ok: true });
    expect(mocks.tx.team.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: expect.objectContaining({ registrantEmail: "sara.new@example.com" }) });
    expect(mocks.tx.competitorPortrait.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale page, a foreign seat, a third person — after the lock", async () => {
    expect(await editRegistration(db as never, full, form({}, {}, { expectedVersion: 1 }), before)).toEqual({ ok: false, error: "STALE_MEMBERSHIP" });
    expect(await editRegistration(db as never, full, form({ id: "not-here" }), before)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await swapSeat(db as never, full, { ...swapIn, expectedVersion: 3 }, before)).toEqual({ ok: false, error: "STALE_MEMBERSHIP" });
    expect(Math.min(...mocks.tx.$queryRaw.mock.invocationCallOrder)).toBeLessThan(Math.min(...mocks.tx.team.findFirst.mock.invocationCallOrder));
  });

  it("a one-seat team (seat 2 only): 'Add partner' goes to the free position 1", async () => {
    mocks.tx.team.findFirst.mockResolvedValue(team({ competitors: [team().competitors[1]] }));
    expect(await editRegistration(db as never, full, form({}, {}, { one: { id: "seat-sara", fullName: "Sara Ali", email: "sara@example.com", phone: null, dateOfBirth: null, studioId: null }, two: { fullName: "Mona Saleh", email: "mona@example.com", phone: null, dateOfBirth: null, studioId: null } }), before)).toEqual({ ok: true });
    expect(mocks.tx.competitor.create).toHaveBeenCalledWith({ data: expect.objectContaining({ teamId: "t1", position: 1, fullName: "Mona Saleh" }) });
  });

  it("a failed audit write fails the change", async () => {
    mocks.audit.mockRejectedValue(new Error("audit down"));
    await expect(swapSeat(db as never, full, swapIn, before)).rejects.toThrow("audit down");
    await expect(editRegistration(db as never, full, form({ fullName: "Mona A. Saleh" }), before)).rejects.toThrow("audit down");
  });
});
