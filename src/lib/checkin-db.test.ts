/**
 * Writing the two check-ins: who may, whose teams, that pressing twice is one
 * check-in, that one athlete arriving is not the team arriving — and that the
 * entrance and the warm-up never write each other's fact.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setAthleteArrival, setTeamArrival, setWarmupReady, syncTeamArrival, type CheckInActor } from "@/lib/checkin-db";
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

/** A tiny in-memory team: two seats, the arrival columns, the readiness column. */
type Seat = { id: string; fullName: string; attendedAt: Date | null };
let row: { id: string; number: number; name: string; attendedAt: Date | null; warmupReadyAt: Date | null; seats: Seat[]; series: { status: string; archivedAt: Date | null } };
let writes: { table: string; data: Record<string, unknown> }[];
let teamWhere: Record<string, unknown>[];

const tx = {
  $queryRaw: vi.fn(async () => []),
  team: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      teamWhere.push(where);
      return where.id === row.id ? { ...row, competitors: row.seats } : null;
    }),
    findUnique: vi.fn(async () => ({ attendedAt: row.attendedAt, competitors: row.seats })),
    update: vi.fn(async ({ data }: { data: Record<string, Date | null> }) => {
      writes.push({ table: "team", data });
      Object.assign(row, data);
    }),
  },
  competitor: {
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
      const seat = row.seats.find((one) => one.id === where.id);
      return seat ? { ...seat, teamId: row.id, team: { id: row.id, number: row.number, name: row.name } } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { attendedAt: Date | null } }) => {
      writes.push({ table: "competitor", data });
      row.seats.find((one) => one.id === where.id)!.attendedAt = data.attendedAt;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { attendedAt?: null }; data: { attendedAt: Date | null } }) => {
      writes.push({ table: "competitor", data });
      for (const seat of row.seats) if (where.attendedAt === null ? !seat.attendedAt : seat.attendedAt) seat.attendedAt = data.attendedAt;
    }),
  },
};
const db = { ...tx, $transaction: (work: (client: typeof tx) => unknown) => work(tx) } as never;

beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  teamWhere = [];
  row = {
    id: "t1", number: 7, name: "FALCONS", attendedAt: null, warmupReadyAt: null, series: { status: "live", archivedAt: null },
    seats: [{ id: "seat-mona", fullName: "Mona Saleh", attendedAt: null }, { id: "seat-sara", fullName: "Sara Ali", attendedAt: null }],
  };
});

describe("who may check in at the entrance", () => {
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
    // Event staff and BFT MENA reach every team.
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
  it("checks the whole team in: both athletes and the team, at the same moment", async () => {
    expect(await setTeamArrival(db, organiser, { teamId: "t1", attended: true }, NOW)).toEqual({
      ok: true, changed: true, team: { id: "t1", label: "7 FALCONS" }, detail: "checked in (2 of 2 athletes)",
    });
    expect(row.attendedAt).toEqual(NOW);
    expect(row.seats.map((seat) => seat.attendedAt)).toEqual([NOW, NOW]);
  });

  it("counts a repeated check-in once: the first time stands and nothing is written again", async () => {
    await setTeamArrival(db, organiser, { teamId: "t1", attended: true }, EARLIER);
    writes = [];
    expect(await setTeamArrival(db, volunteer, { teamId: "t1", attended: true }, NOW)).toMatchObject({ ok: true, changed: false });
    expect(await setAthleteArrival(db, volunteer, { competitorId: "seat-sara", attended: true }, NOW)).toMatchObject({ ok: true, changed: false });
    expect(writes).toEqual([]);
    expect(row.attendedAt).toEqual(EARLIER);
    expect(row.seats.map((seat) => seat.attendedAt)).toEqual([EARLIER, EARLIER]);
  });

  it("one athlete arriving is a PARTIAL arrival: the team is not checked in, the partner is not counted", async () => {
    expect(await setAthleteArrival(db, organiser, { competitorId: "seat-mona", attended: true }, EARLIER)).toMatchObject({ ok: true, changed: true, detail: "Mona Saleh checked in" });
    expect(row.seats.map((seat) => Boolean(seat.attendedAt))).toEqual([true, false]);
    expect(row.attendedAt).toBeNull();
  });

  it("the team becomes checked in when its last athlete arrives — stamped with that moment", async () => {
    await setAthleteArrival(db, organiser, { competitorId: "seat-mona", attended: true }, EARLIER);
    await setAthleteArrival(db, organiser, { competitorId: "seat-sara", attended: true }, NOW);
    expect(row.attendedAt).toEqual(NOW);
    expect(row.seats.map((seat) => seat.attendedAt)).toEqual([EARLIER, NOW]);
  });

  it("'check in whole team' after one arrived keeps the first athlete's time", async () => {
    await setAthleteArrival(db, organiser, { competitorId: "seat-mona", attended: true }, EARLIER);
    expect(await setTeamArrival(db, organiser, { teamId: "t1", attended: true }, NOW)).toMatchObject({ ok: true, changed: true });
    expect(row.seats.map((seat) => seat.attendedAt)).toEqual([EARLIER, NOW]);
    expect(row.attendedAt).toEqual(NOW);
  });

  it("undoing one athlete makes a checked-in team partial again", async () => {
    await setTeamArrival(db, organiser, { teamId: "t1", attended: true }, NOW);
    expect(await setAthleteArrival(db, organiser, { competitorId: "seat-sara", attended: false }, NOW)).toMatchObject({ ok: true, changed: true, detail: "Sara Ali: check-in removed" });
    expect(row.attendedAt).toBeNull();
    expect(row.seats.map((seat) => Boolean(seat.attendedAt))).toEqual([true, false]);
  });

  it("undoing the team clears everybody; undoing twice changes nothing", async () => {
    await setAthleteArrival(db, organiser, { competitorId: "seat-mona", attended: true }, NOW);
    expect(await setTeamArrival(db, organiser, { teamId: "t1", attended: false }, NOW)).toMatchObject({ ok: true, changed: true, detail: "check-in removed" });
    expect(row.seats.every((seat) => seat.attendedAt === null)).toBe(true);
    writes = [];
    expect(await setTeamArrival(db, organiser, { teamId: "t1", attended: false }, NOW)).toMatchObject({ ok: true, changed: false });
    expect(writes).toEqual([]);
  });

  it("decides under a lock on the team row, so two desks cannot disagree", async () => {
    await setAthleteArrival(db, organiser, { competitorId: "seat-mona", attended: true }, NOW);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.competitor.update.mock.invocationCallOrder[0]);
  });
});

describe("a seat that changes hands", () => {
  it("a checked-in team with a newcomer in a seat is no longer fully arrived", async () => {
    row.attendedAt = EARLIER;
    row.seats = [{ id: "seat-mona", fullName: "Nour Hassan", attendedAt: null }, { id: "seat-sara", fullName: "Sara Ali", attendedAt: EARLIER }];
    await syncTeamArrival(tx as never, "t1");
    expect(row.attendedAt).toBeNull();
  });

  it("leaves a team alone when its seats already agree with it", async () => {
    await syncTeamArrival(tx as never, "t1");
    row.attendedAt = NOW;
    row.seats.forEach((seat) => (seat.attendedAt = NOW));
    await syncTeamArrival(tx as never, "t1");
    expect(writes).toEqual([]);
  });
});

describe("warm-up check-in — a separate fact", () => {
  it("marks a team ready without touching its entrance check-in, arrived or not", async () => {
    expect(await setWarmupReady(db, volunteer, { teamId: "t1", ready: true }, NOW)).toEqual({
      ok: true, changed: true, team: { id: "t1", label: "7 FALCONS" }, detail: "ready to compete (warm-up)",
    });
    expect(row.warmupReadyAt).toEqual(NOW);
    // The only write names the readiness column and nothing else.
    expect(writes).toEqual([{ table: "team", data: { warmupReadyAt: NOW } }]);
    expect(row.attendedAt).toBeNull();
    expect(row.seats.every((seat) => seat.attendedAt === null)).toBe(true);
  });

  it("entrance check-in never marks a team ready, and undoing it never un-readies one", async () => {
    await setTeamArrival(db, organiser, { teamId: "t1", attended: true }, NOW);
    expect(row.warmupReadyAt).toBeNull();
    await setWarmupReady(db, organiser, { teamId: "t1", ready: true }, NOW);
    await setTeamArrival(db, organiser, { teamId: "t1", attended: false }, NOW);
    await setAthleteArrival(db, organiser, { competitorId: "seat-mona", attended: true }, NOW);
    expect(row.warmupReadyAt).toEqual(NOW);
    // No entrance write ever named the readiness column.
    expect(writes.filter((write) => write.table === "competitor" || "attendedAt" in write.data).every((write) => !("warmupReadyAt" in write.data))).toBe(true);
  });

  it("is safe to press twice, in both directions", async () => {
    await setWarmupReady(db, organiser, { teamId: "t1", ready: true }, EARLIER);
    writes = [];
    expect(await setWarmupReady(db, volunteer, { teamId: "t1", ready: true }, NOW)).toMatchObject({ ok: true, changed: false });
    expect(row.warmupReadyAt).toEqual(EARLIER);
    expect(await setWarmupReady(db, organiser, { teamId: "t1", ready: false }, NOW)).toMatchObject({ ok: true, changed: true, detail: "warm-up readiness removed" });
    expect(await setWarmupReady(db, organiser, { teamId: "t1", ready: false }, NOW)).toMatchObject({ ok: true, changed: false });
    expect(writes).toEqual([{ table: "team", data: { warmupReadyAt: null } }]);
  });

  it("leaves a finished competition's floor alone, and never reaches a team on the waiting list", async () => {
    row.series.status = "final";
    expect(await setWarmupReady(db, admin, { teamId: "t1", ready: true })).toEqual({ ok: false, error: "SERIES_FINISHED" });
    expect(teamWhere.at(-1)).toMatchObject({ waitlistedAt: null });
    expect(writes).toEqual([]);
  });
});
