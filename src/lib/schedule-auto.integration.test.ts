/**
 * THE CATEGORY SCHEDULE AND AUTO ASSIGN, AGAINST A REAL DATABASE.
 *
 * The actions themselves run — the app's Prisma client pointed (in
 * vi.hoisted, before it is imported) at a throwaway schema built from the
 * project's migrations. Only the session is stood in for.
 *
 * Skipped unless INTEGRATION_DB=1, and refuses anything but localhost:
 *
 *   INTEGRATION_DB=1 npx vitest run src/lib/schedule-auto.integration.test.ts
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
  url.pathname = `/pudem_sched_${Math.random().toString(36).slice(2, 12)}`;
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
    // A refusal from requireAccess is a redirect in the app.
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
import { updateSeriesSettings } from "@/lib/actions/series";
import { deleteWave } from "@/lib/actions/waves";
import { actors, createSchema, FITTING, layout, seed, team } from "@/lib/schedule-integration-fixture";

const as = (actor: unknown) => { env.actor.current = actor; };
const assign = () => autoAssignWaves({ seriesId: "s1", perWave: 7 });
const schedule = (over: Partial<Record<string, { startTime?: string; breakMinutes?: number; position?: number }>> = {}) =>
  saveCategorySchedule({ seriesId: "s1", blocks: FITTING.map((block) => ({ ...block, ...over[block.category] })) });
const waves = () => prisma.wave.findMany({ where: { seriesId: "s1" }, orderBy: { number: "asc" }, include: { teams: { orderBy: { station: "asc" } } } });
const moveInto = async (number: number, waveNumber: number, station: number | null, confirm = { confirmException: true, confirmAwards: true }) => {
  const one = await team(prisma, number);
  const target = await prisma.wave.findFirstOrThrow({ where: { seriesId: "s1", number: waveNumber } });
  return moveTeam({ teamId: one.id, waveId: target.id, station, expectedWaveId: one.waveId, expectedStation: one.station, ...confirm });
};

describe.skipIf(!env.on)("category schedule and Auto Assign on a real database", { timeout: 90_000 }, () => {
  let drop: (() => Promise<void>) | undefined;
  beforeAll(async () => { drop = await createSchema(env.base, env.schemaUrl); }, 180_000);
  afterAll(async () => { await prisma.$disconnect(); await drop?.(); });
  beforeEach(async () => { await seed(prisma); as(actors.hq); });

  it("does not run until every category has a start and a break — the current waves stay as they are", async () => {
    await prisma.wave.create({ data: { id: "legacy", seriesId: "s1", number: 1, startTime: "08:00" } });
    await prisma.team.update({ where: { id: "t21" }, data: { waveId: "legacy", station: 4 } });
    expect(await assign()).toEqual({ ok: false, error: "CATEGORY_SCHEDULE_MISSING" });
    expect(await prisma.team.findUniqueOrThrow({ where: { id: "t21" } })).toMatchObject({ waveId: "legacy", station: 4 });
    expect(await prisma.categorySchedule.count()).toBe(0);
  });

  it("scenarios 1 and 5 — Men, Mixed, Women in the configured order at the configured starts, never mixed", async () => {
    expect(await schedule()).toEqual({ ok: true, conflicts: [] });
    expect(await assign()).toEqual({ ok: true });
    const rows = await waves();
    expect(rows.map((wave) => [wave.number, wave.startTime, wave.blockCategory, wave.teams.length])).toEqual([
      [1, "09:00", "Mens", 7], [2, "09:20", "Mens", 1], [3, "11:35", "Mixed", 5], [4, "14:00", "Womens", 3],
    ]);
    for (const wave of rows) for (const one of wave.teams) expect(one.category).toBe(wave.blockCategory);
    // Rookie before Open before Pro; each wave filled before the next.
    expect(rows[0].teams.map((one) => one.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rows[1].teams.map((one) => one.number)).toEqual([8]);
    // A different order is followed just the same.
    await schedule({ Womens: { position: 1, startTime: "08:00" }, Mens: { position: 2, startTime: "10:45" }, Mixed: { position: 3, startTime: "13:30" } });
    expect(await assign()).toEqual({ ok: true });
    expect((await waves()).map((wave) => [wave.startTime, wave.blockCategory])).toEqual([["08:00", "Womens"], ["10:45", "Mens"], ["11:05", "Mens"], ["13:30", "Mixed"]]);
    expect((await prisma.adminAuditLog.findMany({ where: { action: "event.category_schedule_changed" } })).map((line) => line.actorId)).toEqual(["u-hq", "u-hq"]);
  });

  it("scenarios 2 and 3 — the break runs from the last wave's FINISH: 60 minutes, and longer", async () => {
    // Men's last wave starts 09:20 and finishes 10:35; with 60 minutes, Mixed may start at 11:35 and not a minute before.
    expect((await schedule({ Mixed: { startTime: "11:34" } })).ok && true).toBe(true);
    const short = await assign();
    expect(short).toMatchObject({ ok: false, error: "SCHEDULE_CONFLICT" });
    expect(!short.ok && short.conflicts).toEqual([expect.objectContaining({ kind: "OVERRUN", category: "Mens", nextCategory: "Mixed", shortByMinutes: 1, finishMinutes: 635, earliestNextMinutes: 695 })]);
    await schedule();
    expect(await assign()).toEqual({ ok: true });
    // 150 minutes after Mixed (11:35–12:50): Women from 15:20.
    await schedule({ Mixed: { breakMinutes: 150 }, Womens: { startTime: "15:00" } });
    expect(await assign()).toMatchObject({ ok: false, error: "SCHEDULE_CONFLICT", conflicts: [expect.objectContaining({ category: "Mixed", shortByMinutes: 20, breakMinutes: 150 })] });
    await schedule({ Mixed: { breakMinutes: 150 }, Womens: { startTime: "15:20" } });
    expect(await assign()).toEqual({ ok: true });
    expect((await waves()).at(-1)).toMatchObject({ startTime: "15:20", blockCategory: "Womens" });
  });

  it("scenario 4 — not enough time: a conflict with what is needed and what there is, and nothing changes", async () => {
    await schedule();
    await assign();
    const before = await layout(prisma);
    const saved = await schedule({ Mixed: { startTime: "10:00" } });
    // Saved (no team runs manually) and reported.
    expect(saved).toMatchObject({ ok: true, conflicts: [expect.objectContaining({ kind: "OVERRUN", category: "Mens" })] });
    const refused = await assign();
    expect(refused).toMatchObject({ ok: false, error: "SCHEDULE_CONFLICT" });
    expect(!refused.ok && refused.conflicts?.[0]).toMatchObject({ requiredMinutes: 155, availableMinutes: 60, teamsToPlace: 8, placesInTime: 0 });
    expect(await layout(prisma)).toEqual(before);
  });

  it("scenarios 9 and 10 — a team running manually keeps its exact slot through re-runs; returned, it moves on the next", async () => {
    await schedule();
    await assign();
    // Women #21 into the Mixed wave (11:35), whose five Mixed teams stand on 1–5: station 6.
    expect(await moveInto(21, 3, 1)).toEqual({ ok: false, error: "STATION_TAKEN" });
    expect(await moveInto(21, 3, 6)).toEqual({ ok: true });
    const placed = await team(prisma, 21);
    expect(placed).toMatchObject({ station: 6, slotManualAt: expect.any(Date), category: "Womens", waveRef: { startTime: "11:35", blockCategory: "Mixed" } });

    for (let run = 0; run < 2; run++) {
      expect(await assign()).toEqual({ ok: true });
      const kept = await team(prisma, 21);
      expect(kept).toMatchObject({ waveId: placed.waveId, station: 6, waveRef: { startTime: "11:35", blockCategory: "Mixed" } });
      const mixed = (await waves()).find((wave) => wave.id === placed.waveId)!;
      // Its station counted as taken first: the Mixed teams stand on 1–5, never on 6.
      expect(mixed.teams.map((one) => [one.number, one.station])).toEqual([[11, 1], [12, 2], [13, 3], [14, 4], [15, 5], [21, 6]]);
      // The Women block holds the other two; nobody is placed twice.
      expect((await waves()).find((wave) => wave.blockCategory === "Womens")!.teams.map((one) => one.number)).toEqual([22, 23]);
    }
    expect((await prisma.team.findMany({ where: { seriesId: "s1", waveId: null } })).length).toBe(0);

    expect(await returnToAutoAssign({ teamId: "t21", confirmed: true })).toEqual({ ok: true });
    expect(await team(prisma, 21)).toMatchObject({ waveId: placed.waveId, station: 6, slotManualAt: null });
    expect(await assign()).toEqual({ ok: true });
    expect(await team(prisma, 21)).toMatchObject({ waveRef: { blockCategory: "Womens", startTime: "14:00" } });
    expect(await prisma.adminAuditLog.count({ where: { action: "team.slot_released", targetId: "t21" } })).toBe(1);
  });

  it("scenario 12 — a settings change that no longer fits a protected slot is refused, naming it; nothing moves", async () => {
    await schedule();
    await assign();
    expect(await moveInto(21, 3, 6)).toEqual({ ok: true });
    const before = await layout(prisma);
    // The Mixed block moved later than the protected wave.
    expect(await schedule({ Mixed: { startTime: "12:00" }, Womens: { startTime: "14:30" } })).toMatchObject({
      ok: false, error: "PROTECTED_CONFLICT", conflicts: [expect.objectContaining({ kind: "PROTECTED_BEFORE_BLOCK", category: "Mixed", teams: [21] })],
    });
    expect(await prisma.categorySchedule.findUniqueOrThrow({ where: { seriesId_category: { seriesId: "s1", category: "Mixed" } } })).toMatchObject({ startTime: "11:35" });
    // Fewer teams per wave than its station.
    const series = await prisma.series.findUniqueOrThrow({ where: { id: "s1" } });
    const settings = {
      seriesId: "s1", name: series.name, competitionDate: "2030-01-01T09:00", venue: "Venue", firstWaveTime: "09:00", waveIntervalMinutes: 20,
      waveCapacity: 5, zoneWorkMinutes: 15, zoneBreakMinutes: 5, teamEditCloseHours: 24,
    };
    expect(await updateSeriesSettings(settings)).toMatchObject({ ok: false, error: "BEYOND_CAPACITY" });
    // Longer zones make the protected wave itself overrun into Women.
    expect(await updateSeriesSettings({ ...settings, waveCapacity: 7, zoneWorkMinutes: 40 })).toMatchObject({
      ok: false, error: "PROTECTED_CONFLICT", conflicts: [expect.objectContaining({ kind: "OVERRUN", category: "Mixed" })],
    });
    // Removing its wave.
    expect(await deleteWave({ waveId: (await team(prisma, 21)).waveId! })).toMatchObject({ ok: false, error: "PROTECTED_CONFLICT", teams: [21] });
    expect(await layout(prisma)).toEqual(before);
  });

  it("scenario 15 — Auto Assign and a manual move at the same moment: one is seen by the other, never overwritten", async () => {
    await schedule();
    await assign();
    const [moved, assigned] = await Promise.all([moveInto(21, 3, 6), assign()]);
    expect(assigned).toEqual({ ok: true });
    const after = await team(prisma, 21);
    if (moved.ok) {
      expect(after).toMatchObject({ station: 6, slotManualAt: expect.any(Date), waveRef: { blockCategory: "Mixed" } });
    } else {
      expect(moved).toEqual({ ok: false, error: "SCHEDULE_CHANGED" });
      expect(after).toMatchObject({ slotManualAt: null, waveRef: { blockCategory: "Womens" } });
    }
    // Every team placed exactly once, one per station.
    const seats = (await prisma.team.findMany({ where: { seriesId: "s1" }, select: { waveId: true, station: true } })).map((one) => `${one.waveId}/${one.station}`);
    expect(new Set(seats).size).toBe(16);
  });

  it("repeating Auto Assign changes nothing and duplicates nothing", async () => {
    await schedule();
    await assign();
    expect(await moveInto(8, 4, null)).toEqual({ ok: true });
    // The first run after the move settles the running order (Men now fit one wave, so the kept Women wave is renumbered);
    // from then on, running it again changes nothing.
    expect(await assign()).toEqual({ ok: true });
    const once = await layout(prisma);
    await assign();
    await assign();
    expect(await layout(prisma)).toEqual(once);
    expect(await prisma.wave.count({ where: { seriesId: "s1" } })).toBe(3);
    expect(await team(prisma, 8)).toMatchObject({ category: "Mens", slotManualAt: expect.any(Date), waveRef: { blockCategory: "Womens", startTime: "14:00", number: 3 } });
  });

  it("scenario 14 — a judge, a volunteer, a gym and an athlete neither configure nor run it", async () => {
    await schedule();
    for (const actor of [actors.judge, actors.volunteer, actors.gymA, actors.athlete]) {
      as(actor);
      expect(await schedule({ Mens: { startTime: "08:00" } })).toEqual({ ok: false, error: "FORBIDDEN" });
      await expect(assign()).rejects.toThrow("REDIRECTED");
    }
    expect(await prisma.wave.count()).toBe(0);
    expect(await prisma.categorySchedule.findUniqueOrThrow({ where: { seriesId_category: { seriesId: "s1", category: "Mens" } } })).toMatchObject({ startTime: "09:00" });
    // The organiser may.
    as(actors.organiser);
    expect(await assign()).toEqual({ ok: true });
  });
});
