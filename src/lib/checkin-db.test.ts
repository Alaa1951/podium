/**
 * Writing the two check-ins and the two check-outs: who may, whose teams,
 * that pressing twice is one check-in, that one athlete arriving is not the
 * team arriving, that each athlete's own waiver comes first, that warm-up
 * needs the entrance, that a check-out takes readiness back — and that every
 * change leaves one row of history.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAthleteArrival, setTeamArrival, setWarmupReady, syncTeamArrival, teamCheck, type CheckInActor } from "@/lib/checkin-db";
import { resolveEffectivePermissions } from "@/lib/permissions/resolve";
import { systemRole, type AccountType } from "@/lib/permissions/system-roles";

function account(id: string, accountType: AccountType, roles: string[], studioId: string | null = null): CheckInActor {
  return {
    id,
    role: accountType,
    studioId,
    permissions: resolveEffectivePermissions({ accountType, approved: true, roles: roles.map((key) => systemRole(key)!), overrides: null }),
  };
}
const organiser = account("u-org", "organiser", ["organiser"]);
const volunteer = account("u-vol", "organiser", ["volunteer"]);
const gym = account("u-gym", "studio", ["gym-studio"], "studio-a");
const partial = account("u-desk", "staff", ["bft-partial"]);
const admin: CheckInActor = { id: "u-hq", role: "admin", studioId: null, permissions: ["*"] };
const judge = account("u-judge", "organiser", ["judge"]);
const coach = account("u-coach", "organiser", ["coach"]);
const athlete = account("u-sara", "competitor", ["athlete"]);

const NOW = new Date("2026-10-10T06:00:00Z");
const EARLIER = new Date("2026-10-10T05:30:00Z");

/** A tiny in-memory team: two seats, the arrival columns, the readiness columns, a waiver. */
type Seat = { id: string; fullName: string; attendedAt: Date | null; userId: string | null };
let row: {
  id: string; seriesId: string; number: number; name: string; category: "Womens"; archivedAt: Date | null; waitlistedAt: Date | null;
  waveId: string | null; attendedAt: Date | null; warmupReadyAt: Date | null; warmupWaveId: string | null; seats: Seat[];
  series: { status: string; archivedAt: Date | null };
};
let release: { id: string } | null;
let signed: { userId: string; releaseId: string }[];
let writes: { table: string; data: Record<string, unknown> }[];
let events: { kind: string; competitorId: string | null; waveId: string | null; reason: string | null; actorId: string | null }[];
let teamWhere: Record<string, unknown>[];

const seatRow = (seat: Seat) => ({
  ...seat, teamId: row.id, dateOfBirth: null, team: { id: row.id, number: row.number, name: row.name, category: row.category }, user: null,
});
const tx = {
  $queryRaw: vi.fn(async () => []),
  team: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      teamWhere.push(where);
      return where.id === row.id ? row : null;
    }),
    findUnique: vi.fn(async () => ({ ...row, competitors: row.seats })),
    update: vi.fn(async ({ data }: { data: Record<string, Date | string | null> }) => {
      writes.push({ table: "team", data });
      Object.assign(row, data);
    }),
  },
  competitor: {
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
      const seat = row.seats.find((one) => one.id === where.id);
      return seat ? seatRow(seat) : null;
    }),
    findMany: vi.fn(async () => row.seats.map(seatRow)),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { attendedAt: Date | null } }) => {
      writes.push({ table: "competitor", data });
      row.seats.find((one) => one.id === where.id)!.attendedAt = data.attendedAt;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { attendedAt?: null }; data: { attendedAt: Date | null } }) => {
      writes.push({ table: "competitor", data });
      for (const seat of row.seats) if (where.attendedAt === null ? !seat.attendedAt : seat.attendedAt) seat.attendedAt = data.attendedAt;
    }),
  },
  attendanceEvent: {
    createMany: vi.fn(async ({ data }: { data: typeof events }) => { events.push(...data.map(({ kind, competitorId, waveId, reason, actorId }) => ({ kind, competitorId, waveId, reason, actorId }))); }),
  },
  waiverRelease: { findFirst: vi.fn(async () => (release ? { ...release, version: 1, documentKey: "podium-series-1@1", activatedAt: EARLIER, editions: [] } : null)) },
  waiverAcceptance: { findMany: vi.fn(async () => signed) },
  wave: { findUnique: vi.fn(async () => ({ number: 3 })) },
};
const db = { ...tx, $transaction: (work: (client: typeof tx) => unknown) => work(tx) } as never;

const arriveAll = () => row.seats.forEach((seat) => (seat.attendedAt = EARLIER));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EVENT_READINESS_OVERRIDE_SERIES_ID", "");
  writes = [];
  events = [];
  teamWhere = [];
  release = null;
  signed = [];
  row = {
    id: "t1", seriesId: "s1", number: 7, name: "FALCONS", category: "Womens", archivedAt: null, waitlistedAt: null,
    waveId: "w3", attendedAt: null, warmupReadyAt: null, warmupWaveId: null, series: { status: "live", archivedAt: null },
    seats: [{ id: "seat-mona", fullName: "Mona Saleh", attendedAt: null, userId: "u-mona" }, { id: "seat-sara", fullName: "Sara Ali", attendedAt: null, userId: "u-sara" }],
  };
});

afterEach(() => vi.unstubAllEnvs());

describe("who may check in and out", () => {
  it.each([["an Organiser", organiser], ["a Volunteer", volunteer], ["a Gym / Studio account", gym], ["BFT MENA Partial", partial], ["BFT MENA Full", admin]])(
    "%s may",
    async (_label, actor) => {
      expect(await setTeamArrival(db, actor, { teamId: "t1", attended: true }, NOW)).toMatchObject({ ok: true, changed: true });
      expect(await setAthleteArrival(db, actor, { competitorId: "seat-mona", attended: false }, NOW)).toMatchObject({ ok: true, changed: true });
    }
  );

  it.each([["a Judge", judge], ["a Coach", coach], ["an athlete", athlete], ["an athlete handed the key", { ...athlete, permissions: [...athlete.permissions, "registrations.attendance", "checkIn.warmup"] }]])(
    "%s may not — on either desk — and nothing is read or written",
    async (_label, actor) => {
      expect(await setTeamArrival(db, actor, { teamId: "t1", attended: true })).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await setAthleteArrival(db, actor, { competitorId: "seat-mona", attended: true })).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await setWarmupReady(db, actor, { teamId: "t1", ready: true })).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(tx.team.findFirst).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
    }
  );

  it("keeps a gym to its own teams, on both desks", async () => {
    await setTeamArrival(db, gym, { teamId: "t1", attended: true }, NOW);
    await setWarmupReady(db, gym, { teamId: "t1", ready: true }, NOW);
    for (const where of teamWhere) expect(where).toMatchObject({ id: "t1", archivedAt: null, studioId: "studio-a" });
    await setAthleteArrival(db, gym, { competitorId: "seat-mona", attended: false }, NOW);
    expect(tx.competitor.findFirst.mock.calls[0][0].where).toEqual({ id: "seat-mona", team: { archivedAt: null, studioId: "studio-a" } });
    teamWhere = [];
    await setTeamArrival(db, organiser, { teamId: "t1", attended: false }, NOW);
    expect(teamWhere[0]).toEqual({ id: "t1", archivedAt: null });
  });

  it("answers NOT_FOUND for a team outside the scope", async () => {
    expect(await setTeamArrival(db, gym, { teamId: "rival", attended: true })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await setAthleteArrival(db, gym, { competitorId: "rival-seat", attended: true })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await setWarmupReady(db, gym, { teamId: "rival", ready: true })).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});

describe("entrance check-in", () => {
  it("checks the whole team in — both athletes, the team, and a history row each", async () => {
    expect(await setTeamArrival(db, organiser, { teamId: "t1", attended: true }, NOW)).toEqual({
      ok: true, changed: true, team: { id: "t1", label: "7 FALCONS" }, detail: "checked in (2 of 2 athletes)",
    });
    expect(row.attendedAt).toEqual(NOW);
    expect(row.seats.map((seat) => seat.attendedAt)).toEqual([NOW, NOW]);
    expect(events).toEqual([
      { kind: "entrance_in", competitorId: "seat-mona", waveId: null, reason: null, actorId: "u-org" },
      { kind: "entrance_in", competitorId: "seat-sara", waveId: null, reason: null, actorId: "u-org" },
    ]);
  });

  it("with a waiver required: a team check-in names who has not signed and checks NOBODY in", async () => {
    release = { id: "r1" };
    signed = [{ userId: "u-mona", releaseId: "r1" }];
    expect(await setTeamArrival(db, organiser, { teamId: "t1", attended: true }, NOW)).toEqual({
      ok: false, error: "PREREQUISITES",
      gaps: { team: { id: "t1", number: 7, name: "FALCONS" }, gaps: [], athletes: [{ id: "seat-sara", name: "Sara Ali", gaps: ["waiver"] }] },
    });
    expect(row.seats.every((seat) => seat.attendedAt === null)).toBe(true);
    // The one who signed may come in on her own; the other waits for her own signature.
    expect(await setAthleteArrival(db, organiser, { competitorId: "seat-mona", attended: true }, NOW)).toMatchObject({ ok: true, changed: true });
    expect(await setAthleteArrival(db, organiser, { competitorId: "seat-sara", attended: true }, NOW)).toMatchObject({ ok: false, error: "PREREQUISITES" });
    // Once she signs, the same button works.
    signed.push({ userId: "u-sara", releaseId: "r1" });
    expect(await setAthleteArrival(db, organiser, { competitorId: "seat-sara", attended: true }, NOW)).toMatchObject({ ok: true, changed: true });
    expect(row.attendedAt).toEqual(NOW);
  });

  it("a seat with no account cannot have signed: it is named as such", async () => {
    release = { id: "r1" };
    row.seats[1].userId = null;
    signed = [{ userId: "u-mona", releaseId: "r1" }];
    const refused = await setTeamArrival(db, organiser, { teamId: "t1", attended: true }, NOW);
    expect(refused).toMatchObject({ ok: false, gaps: { athletes: [{ name: "Sara Ali", gaps: ["account"] }] } });
  });

  it("counts a repeated check-in once: the first time stands, and no second history row", async () => {
    await setTeamArrival(db, organiser, { teamId: "t1", attended: true }, EARLIER);
    writes = [];
    events = [];
    expect(await setTeamArrival(db, volunteer, { teamId: "t1", attended: true }, NOW)).toMatchObject({ ok: true, changed: false });
    expect(await setAthleteArrival(db, volunteer, { competitorId: "seat-sara", attended: true }, NOW)).toMatchObject({ ok: true, changed: false });
    expect(writes).toEqual([]);
    expect(events).toEqual([]);
    expect(row.seats.map((seat) => seat.attendedAt)).toEqual([EARLIER, EARLIER]);
  });

  it("one athlete arriving is a PARTIAL arrival; the team is checked in when the last one arrives", async () => {
    await setAthleteArrival(db, organiser, { competitorId: "seat-mona", attended: true }, EARLIER);
    expect(row.attendedAt).toBeNull();
    await setAthleteArrival(db, organiser, { competitorId: "seat-sara", attended: true }, NOW);
    expect(row.attendedAt).toEqual(NOW);
  });

  it("decides under a lock on the team row, so two desks — or a wave starting — cannot disagree", async () => {
    await setAthleteArrival(db, organiser, { competitorId: "seat-mona", attended: true }, NOW);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.competitor.update.mock.invocationCallOrder[0]);
  });
});

describe("entrance check-out", () => {
  it("one athlete leaving: recorded, the team partial again, its warm-up readiness taken back — no waiver asked", async () => {
    arriveAll();
    row.attendedAt = EARLIER;
    row.warmupReadyAt = EARLIER;
    row.warmupWaveId = "w3";
    release = { id: "r1" }; // nobody signed: leaving needs no signature
    expect(await setAthleteArrival(db, organiser, { competitorId: "seat-sara", attended: false }, NOW)).toMatchObject({
      ok: true, changed: true, detail: "Sara Ali checked out; warm-up readiness cleared",
    });
    expect(row.attendedAt).toBeNull();
    expect(row.warmupReadyAt).toBeNull();
    expect(events).toEqual([
      { kind: "entrance_out", competitorId: "seat-sara", waveId: null, reason: null, actorId: "u-org" },
      { kind: "warmup_out", competitorId: null, waveId: "w3", reason: "Sara Ali checked out", actorId: "u-org" },
    ]);
  });

  it("the whole team leaving clears everybody; leaving twice changes nothing", async () => {
    arriveAll();
    expect(await setTeamArrival(db, organiser, { teamId: "t1", attended: false }, NOW)).toMatchObject({ ok: true, changed: true, detail: "checked out (2 athletes)" });
    expect(row.seats.every((seat) => seat.attendedAt === null)).toBe(true);
    writes = [];
    events = [];
    expect(await setTeamArrival(db, organiser, { teamId: "t1", attended: false }, NOW)).toMatchObject({ ok: true, changed: false });
    expect(writes).toEqual([]);
    expect(events).toEqual([]);
  });
});

describe("a seat that changes hands", () => {
  it("a checked-in team with a newcomer in a seat is no longer fully arrived", async () => {
    row.attendedAt = EARLIER;
    row.seats = [{ id: "seat-mona", fullName: "Nour Hassan", attendedAt: null, userId: "u-nour" }, { id: "seat-sara", fullName: "Sara Ali", attendedAt: EARLIER, userId: "u-sara" }];
    await syncTeamArrival(tx as never, "t1");
    expect(row.attendedAt).toBeNull();
  });
});

describe("warm-up check-in and check-out", () => {
  it("needs every athlete at the venue first, and says who is not", async () => {
    row.seats[0].attendedAt = EARLIER;
    expect(await setWarmupReady(db, volunteer, { teamId: "t1", ready: true }, NOW)).toEqual({
      ok: false, error: "PREREQUISITES",
      gaps: { team: { id: "t1", number: 7, name: "FALCONS" }, gaps: [], athletes: [{ id: "seat-sara", name: "Sara Ali", gaps: ["entrance"] }] },
    });
    expect(row.warmupReadyAt).toBeNull();
  });

  it("needs a wave, and a place in the field", async () => {
    arriveAll();
    row.waveId = null;
    row.waitlistedAt = EARLIER;
    expect(await setWarmupReady(db, volunteer, { teamId: "t1", ready: true }, NOW)).toMatchObject({ ok: false, gaps: { gaps: ["registration", "no_wave"] } });
  });

  it("ready for THIS wave: the wave is recorded with it, and in the history", async () => {
    arriveAll();
    expect(await setWarmupReady(db, volunteer, { teamId: "t1", ready: true }, NOW)).toEqual({
      ok: true, changed: true, team: { id: "t1", label: "7 FALCONS" }, detail: "ready to compete in wave 3 (warm-up check-in)",
    });
    expect(row).toMatchObject({ warmupReadyAt: NOW, warmupWaveId: "w3" });
    expect(events).toEqual([{ kind: "warmup_in", competitorId: null, waveId: "w3", reason: null, actorId: "u-vol" }]);
    // Arrival is neither read into nor written by it.
    expect(writes.every((write) => !("attendedAt" in write.data))).toBe(true);
  });

  it("is safe to press twice, in both directions — and check-out works even once the waiver is out of date", async () => {
    arriveAll();
    await setWarmupReady(db, organiser, { teamId: "t1", ready: true }, EARLIER);
    events = [];
    expect(await setWarmupReady(db, volunteer, { teamId: "t1", ready: true }, NOW)).toMatchObject({ ok: true, changed: false });
    release = { id: "r2" }; // a new version nobody has signed
    expect(await setWarmupReady(db, organiser, { teamId: "t1", ready: false }, NOW)).toMatchObject({ ok: true, changed: true, detail: "warm-up check-out: readiness cleared" });
    expect(await setWarmupReady(db, organiser, { teamId: "t1", ready: false }, NOW)).toMatchObject({ ok: true, changed: false });
    expect(events.map((event) => event.kind)).toEqual(["warmup_out"]);
  });

  it("leaves a finished competition's floor alone", async () => {
    row.series.status = "final";
    expect(await setWarmupReady(db, admin, { teamId: "t1", ready: true })).toEqual({ ok: false, error: "SERIES_FINISHED" });
    expect(writes).toEqual([]);
  });
});

describe("an event-scoped readiness override", () => {
  beforeEach(() => {
    vi.stubEnv("EVENT_READINESS_OVERRIDE_SERIES_ID", "s1");
    release = { id: "r1" };
    row.seats[1].userId = null;
    // The linked athlete has no acceptance; the other athlete has no account.
    signed = [];
  });

  it("allows whole-team arrival without changing either athlete's waiver state", async () => {
    expect(await setTeamArrival(db, organiser, { teamId: "t1", attended: true }, NOW)).toMatchObject({
      ok: true, changed: true, detail: expect.stringContaining("event-day readiness override"),
    });
    expect(row.seats.map((seat) => seat.attendedAt)).toEqual([NOW, NOW]);
    expect(row.attendedAt).toEqual(NOW);
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.reason === "event-day readiness override")).toBe(true);
    expect((await teamCheck(tx as never, row)).athletes.map((one) => one.waiver)).toEqual(["pending", "no_account"]);
    expect(signed).toEqual([]);
  });

  it.each(["seat-mona", "seat-sara"])("allows only the requested athlete %s to arrive", async (competitorId) => {
    expect(await setAthleteArrival(db, volunteer, { competitorId, attended: true }, NOW)).toMatchObject({ ok: true, changed: true });
    expect(row.seats.find((seat) => seat.id === competitorId)?.attendedAt).toEqual(NOW);
    expect(row.seats.find((seat) => seat.id !== competitorId)?.attendedAt).toBeNull();
    expect(row.attendedAt).toBeNull();
    expect(events).toEqual([{ kind: "entrance_in", competitorId, waveId: null, reason: "event-day readiness override", actorId: "u-vol" }]);
    expect((await teamCheck(tx as never, row)).athletes.map((one) => one.waiver)).toEqual(["pending", "no_account"]);
    expect(signed).toEqual([]);
  });

  it("allows warm-up without entrance arrival and records only warm-up readiness", async () => {
    expect(await setWarmupReady(db, organiser, { teamId: "t1", ready: true }, NOW)).toMatchObject({ ok: true, changed: true });
    expect(row).toMatchObject({ warmupReadyAt: NOW, warmupWaveId: "w3", attendedAt: null });
    expect(row.seats.map((seat) => seat.attendedAt)).toEqual([null, null]);
    expect(writes).toEqual([{ table: "team", data: { warmupReadyAt: NOW, warmupWaveId: "w3" } }]);
    expect(events).toEqual([{ kind: "warmup_in", competitorId: null, waveId: "w3", reason: "event-day readiness override", actorId: "u-org" }]);
    expect((await teamCheck(tx as never, row)).athletes.map((one) => one.waiver)).toEqual(["pending", "no_account"]);
    expect(signed).toEqual([]);
  });

  it("does not bypass any prerequisites for a different competition", async () => {
    vi.stubEnv("EVENT_READINESS_OVERRIDE_SERIES_ID", "other-series");
    expect(await setTeamArrival(db, organiser, { teamId: "t1", attended: true }, NOW)).toMatchObject({ ok: false, error: "PREREQUISITES" });
    expect(await setAthleteArrival(db, organiser, { competitorId: "seat-sara", attended: true }, NOW)).toMatchObject({ ok: false, error: "PREREQUISITES" });
    expect(await setWarmupReady(db, organiser, { teamId: "t1", ready: true }, NOW)).toMatchObject({
      ok: false, error: "PREREQUISITES", gaps: { athletes: [{ gaps: ["waiver", "entrance"] }, { gaps: ["account", "entrance"] }] },
    });
    expect(writes).toEqual([]);
    expect(events).toEqual([]);
  });

  it("still denies an actor without desk permissions", async () => {
    expect(await setTeamArrival(db, judge, { teamId: "t1", attended: true }, NOW)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await setAthleteArrival(db, judge, { competitorId: "seat-sara", attended: true }, NOW)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await setWarmupReady(db, judge, { teamId: "t1", ready: true }, NOW)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(tx.team.findFirst).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("still requires a registration holding a place on both desks", async () => {
    row.waitlistedAt = EARLIER;
    expect(await setTeamArrival(db, organiser, { teamId: "t1", attended: true }, NOW)).toMatchObject({ ok: false, gaps: { gaps: ["registration"], athletes: [] } });
    expect(await setAthleteArrival(db, organiser, { competitorId: "seat-sara", attended: true }, NOW)).toMatchObject({ ok: false, gaps: { gaps: ["registration"], athletes: [] } });
    expect(await setWarmupReady(db, organiser, { teamId: "t1", ready: true }, NOW)).toMatchObject({ ok: false, gaps: { gaps: ["registration"], athletes: [] } });
    expect(writes).toEqual([]);
    expect(events).toEqual([]);
  });

  it("still requires a wave and athletes before warm-up", async () => {
    row.waveId = null;
    expect(await setWarmupReady(db, organiser, { teamId: "t1", ready: true }, NOW)).toMatchObject({ ok: false, gaps: { gaps: ["no_wave"], athletes: [] } });
    row.waveId = "w3";
    row.seats = [];
    expect(await setWarmupReady(db, organiser, { teamId: "t1", ready: true }, NOW)).toMatchObject({ ok: false, gaps: { gaps: ["no_athletes"], athletes: [] } });
    expect(writes).toEqual([]);
    expect(events).toEqual([]);
  });
});
