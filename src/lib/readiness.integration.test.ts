/**
 * WAIVER, ENTRANCE, WARM-UP, START WAVE — against a real database, through
 * the actions themselves (the arrangement is schedule-auto.integration's).
 *
 *   INTEGRATION_DB=1 npx vitest run src/lib/readiness.integration.test.ts
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
  url.pathname = `/pudem_rdy_${Math.random().toString(36).slice(2, 12)}`;
  process.env.DATABASE_URL = url.toString();
  return { on, base, schemaUrl: url.toString(), actor: { current: null as unknown } };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
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
import { moveTeam } from "@/lib/actions/team-slot";
import { controlWave } from "@/lib/actions/waves";
import { buildBoardPayload } from "@/lib/board";
import { setAthleteArrival, setTeamArrival, setWarmupReady } from "@/lib/checkin-db";
import { syncAfterMembershipChange } from "@/lib/membership-sync";
import { actors, createSchema, FITTING, seed } from "@/lib/schedule-integration-fixture";
import { arriveAll, attach, linkAccounts, newVersion, readyAll, signAll } from "@/lib/waiver-integration-fixture";

const as = (actor: unknown) => { env.actor.current = actor; };
const WAVE1 = [1, 2, 3, 4, 5, 6, 7];
const wave = (number: number) => prisma.wave.findFirstOrThrow({ where: { seriesId: "s1", number } });
const start = async (number: number) => controlWave({ waveId: (await wave(number)).id, action: "start" });
const team = (number: number) => prisma.team.findFirstOrThrow({ where: { seriesId: "s1", number }, include: { competitors: { orderBy: { position: "asc" } } } });
const events = (teamId: string) => prisma.attendanceEvent.findMany({ where: { teamId }, orderBy: [{ at: "asc" }, { kind: "asc" }] });

describe.skipIf(!env.on)("readiness before a wave starts, on a real database", { timeout: 120_000 }, () => {
  let drop: (() => Promise<void>) | undefined;
  beforeAll(async () => { drop = await createSchema(env.base, env.schemaUrl); }, 180_000);
  afterAll(async () => { await prisma.$disconnect(); await drop?.(); });
  /** Men wave 1 (#1–#7), wave 2 (#8); Mixed wave 3; Women wave 4. The competition is running; the waiver is required. */
  beforeEach(async () => {
    await seed(prisma);
    as(actors.hq);
    expect(await saveCategorySchedule({ seriesId: "s1", blocks: FITTING })).toMatchObject({ ok: true });
    expect(await autoAssignWaves({ seriesId: "s1", perWave: 7 })).toEqual({ ok: true });
    await prisma.series.update({ where: { id: "s1" }, data: { status: "live" } });
    await linkAccounts(prisma, [...WAVE1, 8, 11]);
    await attach(prisma);
  }, 90_000);

  it("entrance check-in is refused until each athlete has signed — naming them — and nobody is checked in half-way", async () => {
    const one = await team(1);
    const refused = await setTeamArrival(prisma, actors.volunteer, { teamId: one.id, attended: true });
    expect(refused).toMatchObject({ ok: false, error: "PREREQUISITES", gaps: { athletes: [{ name: "Athlete 1-1", gaps: ["waiver"] }, { name: "Athlete 1-2", gaps: ["waiver"] }] } });
    expect((await team(1)).competitors.every((seat) => seat.attendedAt === null)).toBe(true);
    expect(await events(one.id)).toEqual([]);
    await signAll(prisma, [1]);
    expect(await setTeamArrival(prisma, actors.volunteer, { teamId: one.id, attended: true })).toMatchObject({ ok: true, changed: true });
  });

  it("entrance check-out records the departure, keeps the history, and takes back warm-up readiness", async () => {
    await signAll(prisma, [1]);
    await arriveAll(prisma, [1]);
    await readyAll(prisma, [1]);
    const one = await team(1);
    expect(one).toMatchObject({ warmupWaveId: one.waveId });
    expect(await setAthleteArrival(prisma, actors.volunteer, { competitorId: one.competitors[1].id, attended: false })).toMatchObject({ ok: true, changed: true });
    expect(await team(1)).toMatchObject({ attendedAt: null, warmupReadyAt: null, warmupWaveId: null });
    expect((await events(one.id)).map((event) => event.kind)).toEqual(["entrance_in", "entrance_in", "warmup_in", "entrance_out", "warmup_out"]);
    // Coming back: a new arrival row — the history is only ever added to.
    await setAthleteArrival(prisma, actors.volunteer, { competitorId: one.competitors[1].id, attended: true });
    expect((await events(one.id)).filter((event) => event.kind === "entrance_in")).toHaveLength(3);
  });

  it("warm-up check-in needs every athlete signed and here; check-out needs nothing", async () => {
    await signAll(prisma, [1]);
    const one = await team(1);
    expect(await setWarmupReady(prisma, actors.volunteer, { teamId: one.id, ready: true })).toMatchObject({ ok: false, gaps: { athletes: [{ gaps: ["entrance"] }, { gaps: ["entrance"] }] } });
    await arriveAll(prisma, [1]);
    expect(await setWarmupReady(prisma, actors.volunteer, { teamId: one.id, ready: true })).toMatchObject({ ok: true, changed: true });
    // The waiver goes out of date (BFT MENA requires a new version): check-out still works.
    await newVersion(prisma);
    expect(await setWarmupReady(prisma, actors.volunteer, { teamId: one.id, ready: false })).toMatchObject({ ok: true, changed: true });
  });

  it("Start Wave is refused for every missing requirement, by team and athlete — for BFT MENA Full access too — and starts once all are met", async () => {
    await signAll(prisma, WAVE1.filter((n) => n !== 3));
    await arriveAll(prisma, WAVE1.filter((n) => n !== 3 && n !== 4));
    await readyAll(prisma, [1, 2, 5, 6]);
    as(actors.hq);
    const refused = await start(1);
    expect(refused).toMatchObject({ ok: false, error: "NOT_READY" });
    const blockers = (refused as { blockers: { team: { number: number }; gaps: string[]; athletes: { name: string; gaps: string[] }[] }[] }).blockers;
    expect(blockers.map((one) => [one.team.number, one.gaps, one.athletes.map((athlete) => athlete.gaps.join("+"))])).toEqual([
      [3, ["warmup"], ["waiver+entrance", "waiver+entrance"]],
      [4, ["warmup"], ["entrance", "entrance"]],
      [7, ["warmup"], []],
    ]);
    expect((await wave(1)).status).toBe("pending");

    await signAll(prisma, [3]);
    await arriveAll(prisma, [3, 4]);
    await readyAll(prisma, [3, 4, 7]);
    expect(await start(1)).toEqual({ ok: true });
    expect((await wave(1)).status).toBe("running");
    const line = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "event.wave_controlled" } });
    expect(line.detail).toContain("(wave 1, 7 teams, every athlete signed, checked in and ready)");
    // Leaving after the start undoes nothing that has begun.
    await setTeamArrival(prisma, actors.volunteer, { teamId: (await team(2)).id, attended: false });
    expect((await wave(1)).status).toBe("running");
  });

  it("a check-out in flight cannot slip past a start: the start waits for it, then sees it", async () => {
    await signAll(prisma, WAVE1);
    await arriveAll(prisma, WAVE1);
    await readyAll(prisma, WAVE1);
    const five = await team(5);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => { locked = resolve; });
    // A desk's check-out, holding the team row, not yet committed.
    const checkout = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Team WHERE id = ${five.id} FOR UPDATE`;
      await tx.competitor.update({ where: { id: five.competitors[0].id }, data: { attendedAt: null } });
      await tx.team.update({ where: { id: five.id }, data: { attendedAt: null, warmupReadyAt: null, warmupWaveId: null } });
      locked();
      await gate;
    }, { timeout: 60_000 });
    await holding;
    as(actors.hq);
    const starting = start(1);
    // The start is queued on that lock before the check-out commits.
    for (let i = 0; i < 100; i++) {
      const waiting = await prisma.$queryRawUnsafe<{ n: bigint }[]>("SELECT COUNT(*) AS n FROM information_schema.INNODB_TRX WHERE trx_state = 'LOCK WAIT'");
      if (Number(waiting[0].n) > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    release();
    await checkout;
    expect(await starting).toMatchObject({ ok: false, error: "NOT_READY", blockers: [{ team: { number: 5 }, gaps: ["warmup"], athletes: [{ gaps: ["entrance"] }] }] });
    expect((await wave(1)).status).toBe("pending");
  });

  it("a team moved to another wave keeps its signature and its arrival, but warms up again for the new wave", async () => {
    await signAll(prisma, [1, 8]);
    await arriveAll(prisma, [1, 8]);
    await readyAll(prisma, [8]);
    const eight = await team(8);
    as(actors.hq);
    expect(await moveTeam({ teamId: eight.id, waveId: (await wave(1)).id, station: 1, expectedWaveId: eight.waveId, expectedStation: eight.station, swapTeamId: (await team(1)).id })).toEqual({ ok: true });
    expect(await team(8)).toMatchObject({ slotManualAt: expect.any(Date), warmupReadyAt: null, attendedAt: expect.any(Date) });
    const reasons = (await events(eight.id)).filter((event) => event.kind === "warmup_out").map((event) => event.reason);
    expect(reasons).toEqual(["moved to wave 1"]);
    // Wave 2 now holds #1, which never warmed up for it.
    expect(await start(2)).toMatchObject({ ok: false, blockers: [{ team: { number: 1 }, gaps: ["warmup"] }] });
  });

  it("a replaced athlete: readiness is taken back, and the newcomer needs their own signature and arrival", async () => {
    await signAll(prisma, [11]);
    await arriveAll(prisma, [11]);
    await readyAll(prisma, [11]);
    const eleven = await team(11);
    await prisma.user.create({ data: { id: "acct-new", email: "new@example.com", name: "Newcomer", role: "competitor", status: "active" } });
    await prisma.$transaction(async (tx) => {
      await tx.competitor.update({ where: { id: eleven.competitors[1].id }, data: { userId: "acct-new", fullName: "Newcomer", attendedAt: null } });
      await syncAfterMembershipChange(tx, { teamId: eleven.id, seriesId: "s1", departedUserIds: [eleven.competitors[1].userId] });
    });
    expect(await team(11)).toMatchObject({ warmupReadyAt: null, attendedAt: null });
    expect(await setWarmupReady(prisma, actors.volunteer, { teamId: eleven.id, ready: true })).toMatchObject({ ok: false, gaps: { athletes: [{ name: "Newcomer", gaps: ["waiver", "entrance"] }] } });
  });

  it("the live board's Up next holds exactly the next wave's teams — never the unplaced field", async () => {
    // Everybody paid (the board shows paid teams); three teams unplaced, still carrying the bare number 1.
    await prisma.team.updateMany({ where: { seriesId: "s1" }, data: { paymentStatus: "paid" } });
    await prisma.team.updateMany({ where: { seriesId: "s1", number: { in: [22, 23, 15] } }, data: { waveId: null, station: null, wave: 1 } });
    const payload = (await buildBoardPayload("s1"))!;
    expect(payload.nextWave?.number).toBe(1);
    expect(payload.teams.filter((one) => one.wave === 1).map((one) => one.number).sort((a, b) => a - b)).toEqual(WAVE1);
    expect(payload.teams.filter((one) => one.wave === null).map((one) => one.number).sort((a, b) => a - b)).toEqual([15, 22, 23]);
  });
});
