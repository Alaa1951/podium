/**
 * CHANGING A TEAM'S CATEGORY OR LEVEL, AGAINST A REAL DATABASE — a throwaway
 * schema built from the project's migrations (so the migration that ships the
 * new role keys is what runs). The actors hold the shipped roles.
 *
 * Skipped unless INTEGRATION_DB=1, and refuses anything but localhost:
 *
 *   INTEGRATION_DB=1 npx vitest run src/lib/desk-bracket.integration.test.ts
 */
import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const enabled = vi.hoisted(() => {
  const on = process.env.INTEGRATION_DB === "1";
  if (on) {
    try { process.loadEnvFile(".env"); } catch { /* DATABASE_URL must already be set */ }
  }
  process.env.NEXTAUTH_SECRET ||= "integration-test-secret";
  if (!on) process.env.DATABASE_URL ||= "mysql://skipped@127.0.0.1:1/skipped";
  return on;
});

import type { PrismaClient } from "@/generated/prisma/client";
import { changeBracket, type BracketInput } from "@/lib/bracket-change";
import { checkInTotals, totalsByBracket } from "@/lib/checkin";
import { setAthleteArrival, setTeamArrival, setWarmupReady } from "@/lib/checkin-db";
import { actors, audits, createSchema, field, seed, teamRow } from "@/lib/desk-integration-fixture";
import { SYSTEM_ROLES } from "@/lib/permissions/system-roles";

const { sara, lina, organiser, volunteer, judge, gymA, gymB, partial } = actors;
let prisma: PrismaClient;
let drop: () => Promise<void>;

const CHANGED = "registration.bracket_changed";
const mine = (over: Partial<BracketInput> = {}): BracketInput =>
  ({ by: "athlete", teamId: "t1", category: "Womens", division: "Rookie", expected: { category: "Womens", division: "Open" }, ...over }) as BracketInput;
const assisted = (over: Partial<BracketInput> = {}): BracketInput =>
  ({ by: "staff", athleteApproved: true, teamId: "t1", category: "Womens", division: "Rookie", expected: { category: "Womens", division: "Open" }, ...over }) as BracketInput;
const hawks = (over: Partial<BracketInput> = {}) => ({ teamId: "t2", category: "Mixed", division: "Rookie", expected: { category: "Mixed", division: "Open" }, ...over }) as Partial<BracketInput>;

describe.skipIf(!enabled)("category and level on a real database", { timeout: 60_000 }, () => {
  beforeAll(async () => { ({ prisma, drop } = await createSchema("pudem_bracket")); }, 180_000);
  afterAll(async () => { await drop?.(); });
  beforeEach(async () => { await seed(prisma); });

  it("the migration gives the shipped desk roles the new keys once, and leaves Judge, Coach, Athlete and custom roles alone", async () => {
    const before = ["registrations.view"];
    await prisma.accessRole.deleteMany();
    for (const role of SYSTEM_ROLES) await prisma.accessRole.create({ data: { key: role.key, name: role.name, permissions: before, isSystem: true } });
    await prisma.accessRole.create({ data: { key: "custom-desk", name: "Custom", permissions: before, isSystem: false } });
    const sql = fs.readFileSync("prisma/migrations/20260930120000_bracket_change_and_check_in/migration.sql", "utf8");
    const statements = sql.split(";").map((one) => one.replace(/^\s*--.*$/gm, "").trim()).filter((one) => one.startsWith("UPDATE `AccessRole`"));
    expect(statements).toHaveLength(4);
    // Twice: a second run must add nothing.
    for (const statement of [...statements, ...statements]) await prisma.$executeRawUnsafe(statement);

    const rows = Object.fromEntries((await prisma.accessRole.findMany()).map((row) => [row.key, row.permissions as string[]]));
    const desk = ["registrations.view", "registrations.bracket", "registrations.attendance", "checkIn.view", "checkIn.warmup"];
    for (const key of ["bft-partial", "gym-studio", "organiser", "volunteer"]) expect(rows[key]).toEqual(desk);
    for (const key of ["judge", "coach", "athlete", "custom-desk"]) expect(rows[key]).toEqual(before);
    await prisma.accessRole.deleteMany();
  });

  it("an athlete moves her team Open → Rookie and back; the team, both members' entries and the audit trail agree", async () => {
    expect(await changeBracket(prisma, sara, mine())).toEqual({ ok: true, changed: true, category: "Womens", division: "Rookie" });
    expect(await teamRow(prisma)).toMatchObject({ category: "Womens", division: "Rookie", waveId: "w1", station: 3, amountMinor: 25000 });
    const entries = await prisma.seriesParticipant.findMany({ where: { seriesId: "s1", userId: { in: ["u-sara", "u-mona"] } } });
    expect(entries.map((entry) => entry.division)).toEqual(["Rookie", "Rookie"]);
    // The other team's members were not touched.
    expect((await prisma.seriesParticipant.findMany({ where: { userId: { in: ["u-lina", "u-omar"] } } })).every((entry) => entry.division === "Open")).toBe(true);

    expect(await changeBracket(prisma, sara, mine({ division: "Open", expected: { category: "Womens", division: "Rookie" } }))).toMatchObject({ ok: true, changed: true, division: "Open" });
    const trail = await audits(prisma, CHANGED);
    expect(trail).toHaveLength(2);
    expect(trail[0]).toMatchObject({ actorId: "u-sara", targetType: "team", targetId: "t1", targetLabel: "7 FALCONS" });
    expect(trail[0].detail).toBe("category Womens (unchanged) · level Open → Rookie · changed by the athlete, on their own team");
    expect(trail[1].detail).toContain("level Rookie → Open");
    expect(trail[0].createdAt).toBeInstanceOf(Date);
  });

  it("an athlete changes category to Mixed and back to Womens; a pair with a man cannot enter Womens", async () => {
    expect(await changeBracket(prisma, sara, mine({ category: "Mixed", division: "Open" }))).toMatchObject({ ok: true, category: "Mixed" });
    expect(await changeBracket(prisma, sara, mine({ category: "Womens", division: "Open", expected: { category: "Mixed", division: "Open" } }))).toMatchObject({ ok: true, category: "Womens" });
    expect(await changeBracket(prisma, lina, mine(hawks({ category: "Womens", division: "Open" })))).toEqual({ ok: false, error: "WOMENS_HAS_A_MAN" });
    expect(await teamRow(prisma, "t2")).toMatchObject({ category: "Mixed", division: "Open" });
  });

  it("an athlete cannot touch another team, move to Pro, or change once the wave has started or a score exists", async () => {
    expect(await changeBracket(prisma, sara, mine(hawks()))).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await changeBracket(prisma, sara, mine({ division: "Pro" }))).toEqual({ ok: false, error: "PRO_IS_BFT_MENA" });
    await prisma.wave.update({ where: { id: "w1" }, data: { status: "running", startedAt: new Date() } });
    expect(await changeBracket(prisma, sara, mine())).toEqual({ ok: false, error: "WAVE_STARTED" });
    await prisma.score.create({ data: { teamId: "t2" } });
    expect(await changeBracket(prisma, lina, mine(hawks()))).toEqual({ ok: false, error: "TEAM_ALREADY_SCORED" });
    expect(await audits(prisma, CHANGED)).toHaveLength(0);
    expect(await teamRow(prisma)).toMatchObject({ division: "Open" });
  });

  it("staff help at the athlete's request: organiser, volunteer, the team's own gym, BFT MENA — with the confirmation, inside their scope", async () => {
    expect(await changeBracket(prisma, volunteer, assisted({ athleteApproved: false } as never))).toEqual({ ok: false, error: "APPROVAL_REQUIRED" });
    expect(await teamRow(prisma)).toMatchObject({ division: "Open" });

    expect(await changeBracket(prisma, volunteer, assisted())).toMatchObject({ ok: true, changed: true });
    expect(await changeBracket(prisma, organiser, assisted({ division: "Open", expected: { category: "Womens", division: "Rookie" } }))).toMatchObject({ ok: true, changed: true });
    expect(await changeBracket(prisma, gymA, assisted({ category: "Mixed", division: "Open" }))).toMatchObject({ ok: true, category: "Mixed" });
    expect(await changeBracket(prisma, partial, assisted({ category: "Mixed", division: "Pro", expected: { category: "Mixed", division: "Open" } }))).toMatchObject({ ok: true, division: "Pro" });

    const trail = await audits(prisma, CHANGED);
    expect(trail.map((line) => line.actorId)).toEqual(["u-vol", "u-org", "u-gym-a", "u-desk"]);
    expect(trail.every((line) => line.detail?.endsWith("staff-assisted: confirmed that the athlete asked for this change and approves it"))).toBe(true);
    expect(trail[2].detail).toContain("category Womens → Mixed");
  });

  it("refuses a judge, and a gym reaching for another gym's team — nothing changes, nothing is audited", async () => {
    expect(await changeBracket(prisma, judge, assisted())).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await changeBracket(prisma, gymB, assisted())).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await changeBracket(prisma, gymA, assisted(hawks()))).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await teamRow(prisma)).toMatchObject({ category: "Womens", division: "Open" });
    expect(await teamRow(prisma, "t2")).toMatchObject({ category: "Mixed", division: "Open" });
    expect(await audits(prisma, CHANGED)).toHaveLength(0);
  });

  it("after the competition's cutoff the athlete and her gym are closed; BFT MENA and event staff still change it, until a score", async () => {
    // Two hours to go: past the default 24-hour cutoff.
    await prisma.series.update({ where: { id: "s1" }, data: { competitionDate: new Date(Date.now() + 2 * 3_600_000), status: "live" } });
    expect(await changeBracket(prisma, sara, mine())).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
    expect(await changeBracket(prisma, gymA, assisted())).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
    expect(await teamRow(prisma)).toMatchObject({ division: "Open" });

    expect(await changeBracket(prisma, volunteer, assisted())).toMatchObject({ ok: true, changed: true });
    expect(await changeBracket(prisma, organiser, assisted({ division: "Open", expected: { category: "Womens", division: "Rookie" } }))).toMatchObject({ ok: true, changed: true });
    // The wave is on the floor and nothing is scored yet: still the desk's to change.
    await prisma.wave.update({ where: { id: "w1" }, data: { status: "running", startedAt: new Date() } });
    expect(await changeBracket(prisma, partial, assisted())).toMatchObject({ ok: true, changed: true });
    expect(await teamRow(prisma)).toMatchObject({ division: "Rookie", waveId: "w1", station: 3 });
    // A score is entered: from here nobody moves the team.
    await prisma.score.create({ data: { teamId: "t1" } });
    for (const actor of [volunteer, organiser, partial]) {
      expect(await changeBracket(prisma, actor, assisted({ division: "Open", expected: { category: "Womens", division: "Rookie" } }))).toEqual({ ok: false, error: "TEAM_ALREADY_SCORED" });
    }
    expect(await audits(prisma, CHANGED)).toHaveLength(3);
  });

  it("the cutoff is the competition's own setting: shortened to one hour, the athlete can change again", async () => {
    await prisma.series.update({ where: { id: "s1" }, data: { competitionDate: new Date(Date.now() + 2 * 3_600_000) } });
    expect(await changeBracket(prisma, sara, mine())).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
    await prisma.series.update({ where: { id: "s1" }, data: { teamEditCloseHours: 1 } });
    expect(await changeBracket(prisma, sara, mine())).toMatchObject({ ok: true, changed: true });
    // Lengthened to two days, ten days out is still open; one day out is not.
    await prisma.series.update({ where: { id: "s1" }, data: { teamEditCloseHours: 48, competitionDate: new Date(Date.now() + 36 * 3_600_000) } });
    expect(await changeBracket(prisma, sara, mine({ division: "Open", expected: { category: "Womens", division: "Rookie" } }))).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
  });

  it("two people changing the same team at once: one wins, the other is told the team has changed", async () => {
    const [first, second] = await Promise.all([
      changeBracket(prisma, sara, mine({ division: "Rookie" })),
      changeBracket(prisma, organiser, assisted({ category: "Mixed", division: "Open" })),
    ]);
    expect([first, second].map((one) => (one.ok ? "ok" : one.error)).sort()).toEqual(["STALE_BRACKET", "ok"]);
    expect(await audits(prisma, CHANGED)).toHaveLength(1);
  });

  it("a category or level change keeps both check-ins and moves the team to its new bracket's totals", async () => {
    await setAthleteArrival(prisma, volunteer, { competitorId: "seat-mona", attended: true });
    await setTeamArrival(prisma, volunteer, { teamId: "t1", attended: true });
    await setWarmupReady(prisma, volunteer, { teamId: "t1", ready: true });
    const before = await teamRow(prisma);
    const totalsBefore = checkInTotals(await field(prisma));

    expect(await changeBracket(prisma, volunteer, assisted({ category: "Mixed", division: "Rookie" }))).toMatchObject({ ok: true, changed: true });

    const after = await teamRow(prisma);
    expect(after).toMatchObject({ category: "Mixed", division: "Rookie", waveId: "w1", station: 3 });
    expect(after.attendedAt).toEqual(before.attendedAt);
    expect(after.warmupReadyAt).toEqual(before.warmupReadyAt);
    expect(after.competitors.map((seat) => seat.attendedAt)).toEqual(before.competitors.map((seat) => seat.attendedAt));

    const rows = totalsByBracket(await field(prisma));
    expect(rows.map((row) => `${row.category} ${row.division}`)).toEqual(["Mixed Rookie", "Mixed Open"]);
    expect(rows[0]).toMatchObject({ teams: { registered: 1, checkedIn: 1 }, athletes: { registered: 2, checkedIn: 2 } });
    expect(checkInTotals(await field(prisma))).toEqual(totalsBefore);
  });
});
