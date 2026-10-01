/**
 * MOVING A TEAM BY HAND, AGAINST A REAL DATABASE — the actions themselves,
 * the app's Prisma client pointed at a throwaway schema (see
 * schedule-auto.integration.test.ts for the arrangement).
 *
 *   INTEGRATION_DB=1 npx vitest run src/lib/schedule-move.integration.test.ts
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
  url.pathname = `/pudem_move_${Math.random().toString(36).slice(2, 12)}`;
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
import { moveTeam, returnToAutoAssign } from "@/lib/actions/team-slot";
import { changeBracket } from "@/lib/bracket-change";
import { loadCheckIn } from "@/lib/checkin-data";
import { admitIfRoom } from "@/lib/crm/admit";
import { actors, createSchema, FITTING, layout, seed, team } from "@/lib/schedule-integration-fixture";

const as = (actor: unknown) => { env.actor.current = actor; };
const waveNumbered = (number: number) => prisma.wave.findFirstOrThrow({ where: { seriesId: "s1", number } });
async function move(number: number, waveNumber: number, over: Record<string, unknown> = {}) {
  const one = await team(prisma, number);
  const target = await waveNumbered(waveNumber);
  return moveTeam({ teamId: one.id, waveId: target.id, station: null, expectedWaveId: one.waveId, expectedStation: one.station, ...over });
}
const audits = (action: string) => prisma.adminAuditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } });

describe.skipIf(!env.on)("moving a team by hand on a real database", { timeout: 90_000 }, () => {
  let drop: (() => Promise<void>) | undefined;
  beforeAll(async () => { drop = await createSchema(env.base, env.schemaUrl); }, 180_000);
  afterAll(async () => { await prisma.$disconnect(); await drop?.(); });
  /** Men waves 1 (09:00) and 2 (09:20), Mixed wave 3 (11:35, five teams), Women wave 4 (14:00, three). */
  beforeEach(async () => {
    await seed(prisma);
    as(actors.hq);
    expect(await saveCategorySchedule({ seriesId: "s1", blocks: FITTING })).toMatchObject({ ok: true });
    expect(await autoAssignWaves({ seriesId: "s1", perWave: 7 })).toEqual({ ok: true });
  });

  it("scenarios 6, 7 and 8 — a Women team into a free Mixed slot: confirmed as an exception, still Women, Running Manually", async () => {
    // Not without confirming the exception — and nothing moves.
    const refused = await move(21, 3);
    expect(refused).toMatchObject({ ok: false, error: "EXCEPTION_UNCONFIRMED", warnings: { exception: { hostBlock: "Mixed" }, awards: null } });
    expect(await team(prisma, 21)).toMatchObject({ waveRef: { number: 4 }, slotManualAt: null });

    as(actors.organiser);
    expect(await move(21, 3, { confirmException: true })).toEqual({ ok: true });
    const moved = await team(prisma, 21);
    expect(moved).toMatchObject({ category: "Womens", division: "Rookie", station: 6, slotManualAt: expect.any(Date), waveRef: { number: 3, blockCategory: "Mixed" } });
    const [line] = await audits("team.slot_moved");
    expect(line).toMatchObject({ actorId: "u-org", targetId: "t21", targetLabel: "21 TEAM 21" });
    expect(line.detail).toContain(`competition "Series" · wave 4 (Womens block, 14:00) station 1 → wave 3 (Mixed block, 11:35) station 6`);
    expect(line.detail).toContain("exception: Womens team in the Mixed block (still competes and is ranked as Womens Rookie)");
    // Ranked in its own bracket: the results read the team's category, not the block.
    expect(await prisma.team.count({ where: { seriesId: "s1", category: "Womens", division: "Rookie" } })).toBe(3);
  });

  it("scenario 11 — an invalid move leaves the original assignment exactly as it was", async () => {
    const before = await layout(prisma);
    const one = await team(prisma, 22);
    // A full wave.
    expect(await move(22, 1, { confirmException: true, confirmAwards: true })).toEqual({ ok: false, error: "WAVE_FULL" });
    // A station somebody stands on.
    expect(await move(22, 3, { station: 2, confirmException: true })).toEqual({ ok: false, error: "STATION_TAKEN" });
    // A station the wave does not have.
    expect(await move(22, 3, { station: 8, confirmException: true })).toEqual({ ok: false, error: "BEYOND_CAPACITY" });
    // A page showing an older slot.
    expect(await moveTeam({ teamId: one.id, waveId: (await waveNumbered(3)).id, station: null, expectedWaveId: one.waveId, expectedStation: 3, confirmException: true, confirmAwards: false }))
      .toEqual({ ok: false, error: "SCHEDULE_CHANGED" });
    // A wave that has started.
    await prisma.wave.update({ where: { id: (await waveNumbered(3)).id }, data: { status: "running", startedAt: new Date() } });
    expect(await move(22, 3, { confirmException: true })).toEqual({ ok: false, error: "WAVE_STARTED" });
    await prisma.wave.update({ where: { id: (await waveNumbered(3)).id }, data: { status: "pending", startedAt: null } });
    // A team with a recorded score.
    const score = await prisma.score.create({ data: { teamId: one.id } });
    const zone = await prisma.zone.findFirstOrThrow({ where: { seriesId: "s1" } });
    await prisma.zoneScore.create({ data: { scoreId: score.id, zoneId: zone.id, status: "submitted" } });
    expect(await move(22, 3, { confirmException: true })).toEqual({ ok: false, error: "TEAM_ALREADY_SCORED" });
    expect(await layout(prisma)).toEqual(before);
    expect(await audits("team.slot_moved")).toHaveLength(0);
  });

  it("scenario 13 — check-in comes along, warm-up readiness does not (it was for the old wave); the team shows in its new wave's lists once", async () => {
    const arrived = new Date("2026-10-10T06:00:00Z");
    await prisma.competitor.updateMany({ where: { teamId: "t21" }, data: { attendedAt: arrived } });
    await prisma.team.update({ where: { id: "t21" }, data: { attendedAt: arrived, warmupReadyAt: arrived } });
    expect(await move(21, 3, { confirmException: true })).toEqual({ ok: true });
    expect(await team(prisma, 21)).toMatchObject({ attendedAt: arrived, warmupReadyAt: null });
    expect((await team(prisma, 21)).competitors.every((seat) => seat.attendedAt?.getTime() === arrived.getTime())).toBe(true);
    const { teams } = await loadCheckIn("s1", actors.hq);
    const listed = teams.filter((one) => one.number === 21);
    expect(listed).toHaveLength(1);
    const mixedWave = await waveNumbered(3);
    expect(listed[0]).toMatchObject({ waveId: mixedWave.id, waveNumber: 3, ready: false, outsideBlock: true, hostBlock: "Mixed" });
    expect(listed[0].athletes.every((athlete) => athlete.arrived)).toBe(true);
    expect(teams.filter((one) => one.waveId === mixedWave.id).map((one) => one.number)).toEqual([11, 12, 13, 14, 15, 21]);
  });

  it("scenario 14 — a judge, an athlete and another gym cannot move a team or remove its protection", async () => {
    await move(21, 3, { confirmException: true });
    const before = await layout(prisma);
    for (const actor of [actors.judge, actors.athlete]) {
      as(actor);
      expect(await move(22, 3, { confirmException: true })).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await returnToAutoAssign({ teamId: "t21", confirmed: true })).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    // A gym reaches only its own teams: #23 is gym B's.
    as(actors.gymA);
    expect(await move(23, 3, { confirmException: true })).toEqual({ ok: false, error: "NOT_FOUND" });
    as(actors.gymB);
    expect(await returnToAutoAssign({ teamId: "t21", confirmed: true })).toEqual({ ok: false, error: "NOT_FOUND" });
    // Protection is only removed on confirmation.
    as(actors.hq);
    expect(await returnToAutoAssign({ teamId: "t21" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await layout(prisma)).toEqual(before);
  });

  it("scenario 16 — a Men team into the Women block finishes after the Men awards begin: warned, confirmed, recorded", async () => {
    const refused = await move(8, 4, { confirmException: true });
    expect(refused).toMatchObject({ ok: false, error: "AWARDS_UNCONFIRMED", warnings: { awards: { category: "Mens", from: "10:35", to: "11:35", finishesAt: "15:15" } } });
    expect(await team(prisma, 8)).toMatchObject({ waveRef: { number: 2 }, slotManualAt: null });
    expect(await move(8, 4, { confirmException: true, confirmAwards: true })).toEqual({ ok: true });
    expect(await team(prisma, 8)).toMatchObject({ category: "Mens", division: "Pro", waveRef: { blockCategory: "Womens" } });
    const [line] = await audits("team.slot_moved");
    expect(line.detail).toContain("finishes 15:15, after the Mens awards period begins (10:35–11:35) — confirmed");
    // A Women team moved EARLIER (into Mixed) gets no awards warning.
    expect(await move(21, 3, { confirmException: true })).toEqual({ ok: true });
  });

  it("a category change cannot quietly turn a manually placed team into an exception", async () => {
    await move(21, 3, { confirmException: true });
    // Women → Mens would leave a Mens team in the Mixed block nobody chose.
    expect(await changeBracket(prisma, actors.hq, {
      by: "staff", athleteApproved: true, teamId: "t21", category: "Mens", division: "Rookie", expected: { category: "Womens", division: "Rookie" },
    })).toEqual({ ok: false, error: "PROTECTED_SLOT" });
    // Into the block's own category, it is simply no longer an exception.
    expect(await changeBracket(prisma, actors.hq, {
      by: "staff", athleteApproved: true, teamId: "t21", category: "Mixed", division: "Rookie", expected: { category: "Womens", division: "Rookie" },
    })).toMatchObject({ ok: true, changed: true });
    expect(await team(prisma, 21)).toMatchObject({ category: "Mixed", slotManualAt: expect.any(Date), waveRef: { number: 3 } });
  });

  it("an automatic admission from the waiting list stays inside the team's own category block", async () => {
    await prisma.team.update({ where: { id: "t15" }, data: { waveId: null, station: null, waitlistedAt: new Date() } });
    // Room exists in Men wave 2 and the Mixed wave: the Mixed team goes to the Mixed block only.
    expect(await admitIfRoom(prisma, "t15")).toMatchObject({ admitted: true, waveNumber: 3 });
    await prisma.team.update({ where: { id: "t14" }, data: { waveId: null, station: null, waitlistedAt: new Date() } });
    await prisma.wave.update({ where: { id: (await waveNumbered(3)).id }, data: { capacity: 3 } });
    // The Mixed wave is now full; Men wave 2 has six free stations, but it is not a Mixed place.
    expect(await admitIfRoom(prisma, "t14")).toEqual({ admitted: false, reason: "NO_ROOM" });
  });
});
