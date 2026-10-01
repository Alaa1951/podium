/**
 * MOVING TEAMS BY HAND — what used to stop some teams from moving, against a
 * real database (the arrangement is schedule-auto.integration.test.ts's):
 *
 *   · a withdrawn team kept its wave and silently filled it: the screen said
 *     6/7, the server said "full";
 *   · a full wave could not be entered at all, and a taken station could not
 *     be exchanged (the board's old station swap) — now two teams EXCHANGE
 *     slots, both running manually, no wave ever holding more teams;
 *   · a team whose own wave had started got the same answer as a started
 *     destination.
 *
 *   INTEGRATION_DB=1 npx vitest run src/lib/schedule-exchange.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const on = process.env.INTEGRATION_DB === "1";
  if (on) {
    try { process.loadEnvFile(".env"); } catch { /* DATABASE_URL must already be set */ }
  }
  process.env.NEXTAUTH_SECRET ||= "integration-test-secret";
  const base = process.env.DATABASE_URL ?? "mysql://skipped@127.0.0.1:1/skipped";
  const url = new URL(base);
  url.pathname = `/pudem_swap_${Math.random().toString(36).slice(2, 12)}`;
  process.env.DATABASE_URL = url.toString();
  return { on, base, schemaUrl: url.toString(), actor: { current: null as unknown } };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: () => undefined }));
vi.mock("@/lib/session", async () => {
  const access = await vi.importActual<typeof import("@/lib/access")>("@/lib/access");
  return {
    ...access,
    getCurrentUser: async () => env.actor.current,
    requireAccess: async (key: Parameters<typeof access.can>[1]) => {
      const user = env.actor.current as Parameters<typeof access.can>[0];
      if (!user || !access.can(user, key)) throw new Error("REDIRECTED");
      return user;
    },
  };
});

import { prisma } from "@/lib/prisma";
import { saveCategorySchedule } from "@/lib/actions/category-schedule";
import { autoAssignWaves } from "@/lib/actions/teams";
import { archiveTeam } from "@/lib/actions/team-people";
import { moveTeam } from "@/lib/actions/team-slot";
import { actors, createSchema, FITTING, layout, seed, team } from "@/lib/schedule-integration-fixture";

const as = (actor: unknown) => { env.actor.current = actor; };
const waveNumbered = (number: number) => prisma.wave.findFirstOrThrow({ where: { seriesId: "s1", number } });
async function move(number: number, waveNumber: number, over: Record<string, unknown> = {}) {
  const one = await team(prisma, number);
  const target = await waveNumbered(waveNumber);
  return moveTeam({ teamId: one.id, waveId: target.id, station: null, expectedWaveId: one.waveId, expectedStation: one.station, ...over });
}
const slot = async (number: number) => {
  const one = await team(prisma, number);
  return { wave: one.waveRef?.number ?? null, station: one.station, manual: Boolean(one.slotManualAt) };
};
const inField = async (waveNumber: number) =>
  prisma.team.count({ where: { waveId: (await waveNumbered(waveNumber)).id, archivedAt: null, waitlistedAt: null } });
const audits = () => prisma.adminAuditLog.findMany({ where: { action: "team.slot_moved" }, orderBy: { createdAt: "asc" } });

describe.skipIf(!env.on)("moving teams by hand: withdrawn teams, full waves, exchanges", { timeout: 90_000 }, () => {
  let drop: (() => Promise<void>) | undefined;
  beforeAll(async () => { drop = await createSchema(env.base, env.schemaUrl); }, 180_000);
  afterAll(async () => { await prisma.$disconnect(); await drop?.(); });
  /** Men wave 1 (09:00, #1–#7, full), wave 2 (09:20, #8); Mixed wave 3 (11:35, #11–#15); Women wave 4 (14:00, #21–#23). */
  beforeEach(async () => {
    await seed(prisma);
    as(actors.hq);
    expect(await saveCategorySchedule({ seriesId: "s1", blocks: FITTING })).toMatchObject({ ok: true });
    expect(await autoAssignWaves({ seriesId: "s1", perWave: 7 })).toEqual({ ok: true });
  });

  it("a withdrawn team gives its place back: the wave the screen shows as 6/7 takes a team", async () => {
    expect(await archiveTeam("t7")).toMatchObject({ ok: true });
    // It keeps its wave on the row (restorable), with no station.
    expect(await prisma.team.findUniqueOrThrow({ where: { id: "t7" } })).toMatchObject({ waveId: (await waveNumbered(1)).id, station: null });
    expect(await inField(1)).toBe(6);
    // Before the fix: { ok: false, error: "WAVE_FULL" }.
    expect(await move(8, 1)).toEqual({ ok: true });
    expect(await slot(8)).toEqual({ wave: 1, station: 7, manual: true });
    expect(await inField(1)).toBe(7);
  });

  it("into a FULL wave by exchange: #8 and #3 swap slots, both run manually, and Auto Assign keeps them exactly", async () => {
    as(actors.organiser);
    const arrived = new Date("2026-10-10T06:00:00Z");
    await prisma.team.update({ where: { id: "t3" }, data: { attendedAt: arrived, warmupReadyAt: arrived } });
    // Without an exchange the full wave refuses, and says so.
    expect(await move(8, 1)).toEqual({ ok: false, error: "WAVE_FULL" });

    expect(await move(8, 1, { station: 3, swapTeamId: "t3" })).toEqual({ ok: true });
    expect(await slot(8)).toEqual({ wave: 1, station: 3, manual: true });
    expect(await slot(3)).toEqual({ wave: 2, station: 1, manual: true });
    expect(await inField(1)).toBe(7);
    expect(await inField(2)).toBe(1);
    // Its bracket and its check-in stay; its warm-up readiness was for the wave it left.
    expect(await team(prisma, 3)).toMatchObject({ category: "Mens", division: "Rookie", attendedAt: arrived, warmupReadyAt: null });
    expect(await team(prisma, 8)).toMatchObject({ category: "Mens", division: "Pro" });
    const lines = await audits();
    expect(lines.map((line) => [line.actorId, line.targetId])).toEqual([["u-org", "t8"], ["u-org", "t3"]]);
    expect(lines[0].detail).toContain("wave 2 (Mens block, 09:20) station 1 → wave 1 (Mens block, 09:00) station 3");
    expect(lines[0].detail).toContain("exchanged with #3 TEAM 3");
    expect(lines[1].detail).toContain("wave 1 (Mens block, 09:00) station 3 → wave 2 (Mens block, 09:20) station 1");

    // Auto Assign again: both stay exactly where the exchange put them.
    as(actors.hq);
    expect(await autoAssignWaves({ seriesId: "s1", perWave: 7 })).toEqual({ ok: true });
    expect([await slot(8), await slot(3)]).toEqual([{ wave: 1, station: 3, manual: true }, { wave: 2, station: 1, manual: true }]);
  });

  it("an exchange inside one wave swaps two stations — what the board's station picker used to do", async () => {
    expect(await move(1, 1, { station: 2, swapTeamId: "t2" })).toEqual({ ok: true });
    expect([await slot(1), await slot(2)]).toEqual([{ wave: 1, station: 2, manual: true }, { wave: 1, station: 1, manual: true }]);
  });

  it("an exchange across categories needs each team's confirmations — then both stay in their own brackets", async () => {
    // #21 (Women) into the Mixed wave; #11 (Mixed) into the Women wave, which ends after the Mixed awards begin.
    const both = { station: 1, swapTeamId: "t11" };
    expect(await move(21, 3, both)).toMatchObject({ ok: false, error: "EXCEPTION_UNCONFIRMED" });
    expect(await move(21, 3, { ...both, confirmException: true })).toMatchObject({ ok: false, error: "SWAP_EXCEPTION_UNCONFIRMED", warnings: { exception: { hostBlock: "Womens" } } });
    expect(await move(21, 3, { ...both, confirmException: true, confirmSwapException: true }))
      .toMatchObject({ ok: false, error: "SWAP_AWARDS_UNCONFIRMED", warnings: { awards: { category: "Mixed", from: "12:50" } } });
    expect(await slot(21)).toEqual({ wave: 4, station: 1, manual: false });
    expect(await move(21, 3, { ...both, confirmException: true, confirmSwapException: true, confirmSwapAwards: true })).toEqual({ ok: true });
    expect(await team(prisma, 21)).toMatchObject({ category: "Womens", station: 1, waveRef: { number: 3, blockCategory: "Mixed" } });
    expect(await team(prisma, 11)).toMatchObject({ category: "Mixed", station: 1, waveRef: { number: 4, blockCategory: "Womens" } });
    const lines = await audits();
    expect(lines[1].detail).toContain("exception: Mixed team in the Womens block");
    expect(lines[1].detail).toContain("after the Mixed awards period begins");
  });

  it("refused exchanges say why, and leave every slot as it was", async () => {
    const before = await layout(prisma);
    // The team on that station has a recorded score.
    const score = await prisma.score.create({ data: { teamId: "t3" } });
    const zone = await prisma.zone.findFirstOrThrow({ where: { seriesId: "s1" } });
    await prisma.zoneScore.create({ data: { scoreId: score.id, zoneId: zone.id, status: "submitted" } });
    expect(await move(8, 1, { station: 3, swapTeamId: "t3" })).toEqual({ ok: false, error: "SWAP_TEAM_SCORED" });
    // The page showed another team on that station.
    expect(await move(8, 1, { station: 4, swapTeamId: "t5" })).toEqual({ ok: false, error: "SCHEDULE_CHANGED" });
    // A gym never shifts another gym's team: #23 is gym B's.
    as(actors.gymA);
    expect(await move(22, 4, { station: 3, swapTeamId: "t23" })).toEqual({ ok: false, error: "STATION_TAKEN" });
    as(actors.hq);
    expect(await layout(prisma)).toEqual(before);
    // A team with no slot to give cannot exchange.
    await prisma.team.update({ where: { id: "t22" }, data: { waveId: null, station: null } });
    expect(await move(22, 1, { station: 1, swapTeamId: "t1", confirmException: true })).toEqual({ ok: false, error: "SWAP_NEEDS_SLOT" });
    expect(await audits()).toHaveLength(0);
  });

  it("a team whose own wave has started is told so — not that the destination has started", async () => {
    await prisma.wave.update({ where: { id: (await waveNumbered(2)).id }, data: { status: "running", startedAt: new Date() } });
    expect(await move(8, 1, { station: 3, swapTeamId: "t3" })).toEqual({ ok: false, error: "TEAM_WAVE_STARTED" });
    expect(await move(1, 2)).toEqual({ ok: false, error: "WAVE_STARTED" });
  });

  it("who may: BFT MENA and the Organiser exchange; a volunteer, a judge and an athlete may not", async () => {
    for (const actor of [actors.volunteer, actors.judge, actors.athlete]) {
      as(actor);
      expect(await move(8, 1, { station: 3, swapTeamId: "t3" })).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    as(actors.organiser);
    expect(await move(8, 1, { station: 3, swapTeamId: "t3" })).toEqual({ ok: true });
    as(actors.hq);
    expect(await move(8, 2, { station: 1, swapTeamId: "t3", expectedWaveId: (await waveNumbered(1)).id })).toMatchObject({ ok: true });
  });
});
