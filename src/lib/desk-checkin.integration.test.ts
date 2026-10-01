/**
 * THE TWO CHECK-INS, AGAINST A REAL DATABASE — a throwaway schema built from
 * the project's migrations (so the migration that adds the columns is what
 * runs). Entrance arrival one athlete at a time, the warm-up desk, and what
 * each of them must NOT change. The actors hold the shipped roles.
 *
 * Skipped unless INTEGRATION_DB=1, and refuses anything but localhost:
 *
 *   INTEGRATION_DB=1 npx vitest run src/lib/desk-checkin.integration.test.ts
 */
import { randomUUID } from "node:crypto";
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
import { checkInTotals } from "@/lib/checkin";
import { setAthleteArrival, setTeamArrival, setWarmupReady } from "@/lib/checkin-db";
import { actors, createSchema, field, seed, teamRow } from "@/lib/desk-integration-fixture";
import { changeMembership } from "@/lib/membership-change";

const { organiser, volunteer, judge, gymB } = actors;
let prisma: PrismaClient;
let drop: () => Promise<void>;

const totals = async () => checkInTotals(await field(prisma));

describe.skipIf(!enabled)("entrance and warm-up check-in on a real database", { timeout: 60_000 }, () => {
  beforeAll(async () => { ({ prisma, drop } = await createSchema("pudem_checkin")); }, 180_000);
  afterAll(async () => { await drop?.(); });
  beforeEach(async () => { await seed(prisma); });

  // ── Entrance ──────────────────────────────────────────────────────────────

  it("entrance check-in, athlete by athlete: partial first, the team when the last one arrives — and the totals follow", async () => {
    expect(await totals()).toEqual({ teams: { registered: 2, checkedIn: 0, notCheckedIn: 2, partial: 0 }, athletes: { registered: 4, checkedIn: 0, notCheckedIn: 4 } });

    expect(await setAthleteArrival(prisma, volunteer, { competitorId: "seat-mona", attended: true })).toMatchObject({ ok: true, changed: true });
    expect((await teamRow(prisma)).attendedAt).toBeNull();
    expect(await totals()).toEqual({ teams: { registered: 2, checkedIn: 0, notCheckedIn: 2, partial: 1 }, athletes: { registered: 4, checkedIn: 1, notCheckedIn: 3 } });

    expect(await setAthleteArrival(prisma, organiser, { competitorId: "seat-sara", attended: true })).toMatchObject({ ok: true, changed: true });
    expect((await teamRow(prisma)).attendedAt).not.toBeNull();
    expect(await totals()).toEqual({ teams: { registered: 2, checkedIn: 1, notCheckedIn: 1, partial: 0 }, athletes: { registered: 4, checkedIn: 2, notCheckedIn: 2 } });

    expect(await setTeamArrival(prisma, gymB, { teamId: "t2", attended: true })).toMatchObject({ ok: true, changed: true });
    expect(await totals()).toEqual({ teams: { registered: 2, checkedIn: 2, notCheckedIn: 0, partial: 0 }, athletes: { registered: 4, checkedIn: 4, notCheckedIn: 0 } });
  });

  it("a repeated check-in is one check-in: the first time stands and the counts do not move", async () => {
    await setTeamArrival(prisma, organiser, { teamId: "t1", attended: true }, new Date("2026-10-10T06:00:00.000Z"));
    const first = await teamRow(prisma);
    for (let press = 0; press < 3; press++) {
      expect(await setTeamArrival(prisma, volunteer, { teamId: "t1", attended: true })).toMatchObject({ ok: true, changed: false });
      expect(await setAthleteArrival(prisma, volunteer, { competitorId: "seat-mona", attended: true })).toMatchObject({ ok: true, changed: false });
    }
    const after = await teamRow(prisma);
    expect(after.attendedAt).toEqual(first.attendedAt);
    expect(after.competitors.map((seat) => seat.attendedAt)).toEqual(first.competitors.map((seat) => seat.attendedAt));
    expect((await totals()).athletes.checkedIn).toBe(2);
  });

  it("two desks checking in the two partners at the same moment leave the team checked in", async () => {
    const results = await Promise.all([
      setAthleteArrival(prisma, volunteer, { competitorId: "seat-mona", attended: true }),
      setAthleteArrival(prisma, organiser, { competitorId: "seat-sara", attended: true }),
    ]);
    expect(results.every((one) => one.ok && one.changed)).toBe(true);
    const team = await teamRow(prisma);
    expect(team.competitors.every((seat) => seat.attendedAt)).toBe(true);
    expect(team.attendedAt).not.toBeNull();
  });

  it("a judge cannot check anybody in or mark anybody ready; a gym cannot reach another gym's team", async () => {
    expect(await setTeamArrival(prisma, judge, { teamId: "t1", attended: true })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await setAthleteArrival(prisma, judge, { competitorId: "seat-mona", attended: true })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await setWarmupReady(prisma, judge, { teamId: "t1", ready: true })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await setTeamArrival(prisma, gymB, { teamId: "t1", attended: true })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await setAthleteArrival(prisma, gymB, { competitorId: "seat-sara", attended: true })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await setWarmupReady(prisma, gymB, { teamId: "t1", ready: true })).toEqual({ ok: false, error: "NOT_FOUND" });
    const team = await teamRow(prisma);
    expect(team).toMatchObject({ attendedAt: null, warmupReadyAt: null });
    expect(team.competitors.every((seat) => seat.attendedAt === null)).toBe(true);
  });

  // ── Warm-up ───────────────────────────────────────────────────────────────

  it("warm-up and entrance stay separate facts — warm-up needs the entrance, and leaving takes readiness back", async () => {
    // Ready before arriving: refused, naming who is not here — and nobody is checked in by it.
    expect(await setWarmupReady(prisma, volunteer, { teamId: "t1", ready: true })).toMatchObject({
      ok: false, error: "PREREQUISITES", gaps: { athletes: [{ name: "Mona Saleh", gaps: ["entrance"] }, { name: "Sara Ali", gaps: ["entrance"] }] },
    });
    let team = await teamRow(prisma);
    expect(team.warmupReadyAt).toBeNull();
    expect(team.competitors.every((seat) => seat.attendedAt === null)).toBe(true);

    // Arriving never makes a team ready.
    await setTeamArrival(prisma, organiser, { teamId: "t1", attended: true });
    team = await teamRow(prisma);
    expect(team.warmupReadyAt).toBeNull();
    const arrived = team.attendedAt;

    // Ready — for its wave — without writing its arrival.
    expect(await setWarmupReady(prisma, volunteer, { teamId: "t1", ready: true })).toMatchObject({ ok: true, changed: true });
    team = await teamRow(prisma);
    expect(team).toMatchObject({ warmupWaveId: "w1", attendedAt: arrived });

    // Warm-up check-out leaves the arrival alone.
    await setWarmupReady(prisma, volunteer, { teamId: "t1", ready: false });
    team = await teamRow(prisma);
    expect(team.warmupReadyAt).toBeNull();
    expect(team.attendedAt).toEqual(arrived);
    expect(team.competitors.every((seat) => seat.attendedAt)).toBe(true);

    // Ready again; one athlete leaves the venue: readiness is taken back.
    await setWarmupReady(prisma, volunteer, { teamId: "t1", ready: true });
    await setAthleteArrival(prisma, organiser, { competitorId: "seat-mona", attended: false });
    expect((await teamRow(prisma)).warmupReadyAt).toBeNull();

    // A team in no wave has nothing to be ready for.
    await setTeamArrival(prisma, gymB, { teamId: "t2", attended: true });
    expect(await setWarmupReady(prisma, gymB, { teamId: "t2", ready: true })).toMatchObject({ ok: false, gaps: { gaps: ["no_wave"] } });
  });

  // ── A seat that changes hands ─────────────────────────────────────────────

  it("a partner replaced after check-in has not arrived: the team is partly arrived until the newcomer checks in", async () => {
    await prisma.series.update({ where: { id: "s1" }, data: { competitionDate: new Date(Date.now() + 10 * 86_400_000), status: "scheduled" } });
    await setTeamArrival(prisma, organiser, { teamId: "t1", attended: true });
    expect(await changeMembership(prisma, { id: "u-sara", email: "u-sara@example.com" }, {
      kind: "replace", operationId: randomUUID(), teamId: "t1", expectedVersion: 0, targetSeatId: "seat-mona",
      expected: { userId: "u-mona", email: "u-mona@example.com" }, fullName: "Nour Hassan", email: "nour@example.com",
    })).toMatchObject({ ok: true, code: "REPLACED" });
    const team = await teamRow(prisma);
    expect(team.attendedAt).toBeNull();
    expect(team.competitors.map((seat) => [seat.fullName, Boolean(seat.attendedAt)])).toEqual([["Nour Hassan", false], ["Sara Ali", true]]);
    expect((await totals()).teams).toMatchObject({ checkedIn: 0, partial: 1 });
  });
});
