/**
 * Real leader score writes, locks and stored role migration in an isolated LOCAL schema.
 * INTEGRATION_DB=1 npx vitest run src/lib/zone-leader-score.integration.test.ts
 */
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const on = process.env.INTEGRATION_DB === "1";
  if (on) {
    try { process.loadEnvFile(".env"); } catch { /* DATABASE_URL can be supplied by the local runner. */ }
  }
  process.env.NEXTAUTH_SECRET ||= "integration-test-secret";
  const base = process.env.DATABASE_URL ?? "mysql://skipped@127.0.0.1:1/skipped";
  const url = new URL(base);
  if (on && !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) throw new Error("LOCAL_DATABASE_ONLY");
  url.pathname = `/pudem_leader_${Math.random().toString(36).slice(2, 12)}`;
  process.env.DATABASE_URL = url.toString();
  return { on, base, schemaUrl: url.toString(), schema: url.pathname.slice(1), actor: { current: null as unknown } };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: () => undefined }));
vi.mock("@/lib/session", async () => {
  const access = await vi.importActual<typeof import("@/lib/access")>("@/lib/access");
  return { ...access, getCurrentUser: async () => env.actor.current, requireUser: async () => env.actor.current };
});

import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/access";
import { saveZoneScore, unlockScore } from "@/lib/actions/scores";
import { loadPermissions } from "@/lib/permissions/load";
import { systemRole } from "@/lib/permissions/system-roles";
import { prisma } from "@/lib/prisma";
import { actors, createSchema, seed } from "@/lib/schedule-integration-fixture";

type Tx = Prisma.TransactionClient;
type Process = { db: string | null; Info: string | null };

describe.skipIf(!env.on)("zone leader score entry against the real local database", { timeout: 45_000 }, () => {
  let drop: (() => Promise<void>) | undefined;
  let leader: CurrentUser;
  let judge: CurrentUser;
  let zones: string[];
  let inputs: string[];
  beforeAll(async () => { drop = await createSchema(env.base, env.schemaUrl); }, 180_000);
  afterAll(async () => { await prisma.$disconnect(); await drop?.(); });
  beforeEach(async () => {
    await seed(prisma);
    await prisma.series.update({ where: { id: "s1" }, data: { status: "live" } });
    const rows = await prisma.zone.findMany({ where: { seriesId: "s1" }, orderBy: { number: "asc" } });
    zones = rows.map((zone) => zone.id);
    inputs = [];
    for (const zone of rows) {
      inputs.push((await prisma.zoneInput.create({ data: {
        zoneId: zone.id, position: 1, label: `Reps ${zone.number}`, unit: "reps", maxValue: 9999,
      } })).id);
    }
    for (const key of ["zone-leaders", "judge"]) {
      const definition = systemRole(key)!;
      await prisma.accessRole.upsert({ where: { key },
        create: { key, name: definition.name, isSystem: true, permissions: [...definition.permissions] },
        update: { permissions: [...definition.permissions] },
      });
    }
    const leaderRole = await prisma.accessRole.findUniqueOrThrow({ where: { key: "zone-leaders" } });
    const judgeRole = await prisma.accessRole.findUniqueOrThrow({ where: { key: "judge" } });
    await prisma.user.create({ data: {
      id: "u-leader", name: "Zone Leader", email: "leader@integration.invalid", role: "organiser", status: "active",
      accessRoles: { create: { accessRoleId: leaderRole.id } },
    } });
    await prisma.userAccessRole.create({ data: { userId: actors.judge.id, accessRoleId: judgeRole.id } });
    leader = { ...actors.organiser, id: "u-leader", email: "leader@integration.invalid", permissions: await loadPermissions("u-leader", "organiser") };
    judge = { ...actors.judge, permissions: await loadPermissions(actors.judge.id, "organiser") };
    expect(leader.permissions).toContain("judgeSheet.leaderView");
    expect(leader.permissions).toContain("scores.enter");
    expect(leader.permissions).not.toContain("judgeSheet.view");
    await prisma.zoneStaff.createMany({ data: [
      { seriesId: "s1", zoneId: zones[0], userId: leader.id, position: "leader" },
      { seriesId: "s1", zoneId: zones[3], userId: leader.id, position: "leader" },
      { seriesId: "s1", zoneId: zones[0], userId: judge.id, position: "judge", station: 1 },
    ] });
    await prisma.wave.create({ data: {
      id: "leader-wave", seriesId: "s1", number: 1, startTime: "09:00", capacity: 7,
      status: "running", startedAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 74 * 60_000), durationMinutes: 75,
    } });
    for (const number of [1, 2, 3]) await prisma.team.update({ where: { id: `t${number}` }, data: {
      paymentStatus: "paid", wave: 1, waveId: "leader-wave", station: number,
    } });
    env.actor.current = leader;
  });

  function save(actor: CurrentUser, value: number, submit = false, teamId = "t1", zoneIndex = 0) {
    env.actor.current = actor;
    return saveZoneScore({ teamId, zoneId: zones[zoneIndex], values: { [inputs[zoneIndex]]: value }, submit, autosave: true });
  }
  const value = async (teamId = "t1", index = 0) => (await prisma.zoneEntry.findFirst({
    where: { score: { teamId }, inputId: inputs[index] },
  }))?.value;
  const shift = (minutes: number, tx: Tx = prisma) => tx.wave.update({ where: { id: "leader-wave" }, data: {
    startedAt: new Date(Date.now() - minutes * 60_000), endsAt: new Date(Date.now() + (75 - minutes) * 60_000),
  } });

  // Observe the real blocked SQL, rather than assuming a sleep let the action reach its lock.
  async function waitForLocks(table: "Wave" | "Team", count = 1) {
    await vi.waitFor(async () => {
      const processes = await prisma.$queryRawUnsafe<Process[]>("SHOW FULL PROCESSLIST");
      const waiting = processes.filter((process) => process.db === env.schema
        && new RegExp(`SELECT id FROM ${table}\\b.*FOR UPDATE`, "is").test(process.Info ?? ""));
      expect(waiting.length).toBeGreaterThanOrEqual(count);
    }, { timeout: 5_000, interval: 25 });
  }

  async function whileWaiting(change: (tx: Tx) => Promise<unknown>) {
    let pending: ReturnType<typeof save> | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Wave WHERE id = ${"leader-wave"} FOR UPDATE`;
      pending = save(leader, 99);
      await waitForLocks("Wave");
      await change(tx);
    }, { timeout: 15_000 });
    return pending!;
  }

  it("stored leader role writes every station only in its assigned zone and preserves another zone", async () => {
    await prisma.score.create({ data: { teamId: "t1", entries: { create: [{ inputId: inputs[1], value: 777 }] } } });
    for (const station of [1, 2, 3]) expect(await save(leader, 10 + station, false, `t${station}`)).toMatchObject({ ok: true });
    expect(await value("t3")).toBe(13);
    expect(await save(leader, 50, false, "t1", 1)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await value("t1", 1)).toBe(777);
    expect(await prisma.scoreAudit.count({ where: { operatorId: leader.id } })).toBe(3);
  });

  it("allows changeover, closes after it, and preserves the judge's later on-duty entry", async () => {
    await shift(16);
    expect(await save(leader, 16)).toMatchObject({ ok: true });
    await shift(21);
    expect(await save(leader, 21)).toEqual({ ok: false, error: "ZONE_ENTRY_CLOSED" });
    expect(await save(judge, 22)).toMatchObject({ ok: true });
    expect(await value()).toBe(22);
    await shift(76);
    expect(await save(leader, 76, false, "t1", 3)).toEqual({ ok: false, error: "ZONE_ENTRY_CLOSED" });
  });

  it("rechecks the deadline after waiting for Wave and does not create a score or audit", async () => {
    expect(await whileWaiting((tx) => tx.wave.update({ where: { id: "leader-wave" }, data: {
      status: "complete", endsAt: new Date(),
    } }))).toEqual({ ok: false, error: "ZONE_ENTRY_CLOSED" });
    expect(await prisma.score.count()).toBe(0);
    expect(await prisma.scoreAudit.count()).toBe(0);
  });

  it("a Reset and restart of the same Wave id while waiting refuses the old run's write", async () => {
    expect(await whileWaiting(async (tx) => {
      await tx.wave.update({ where: { id: "leader-wave" }, data: { status: "pending", startedAt: null, endsAt: null } });
      await tx.wave.update({ where: { id: "leader-wave" }, data: {
        status: "running", startedAt: new Date(Date.now() - 5_000), endsAt: new Date(Date.now() + 75 * 60_000 - 5_000),
      } });
    })).toEqual({ ok: false, error: "WAVE_RESTARTED" });
    expect(await prisma.score.count()).toBe(0);
    expect(await prisma.scoreAudit.count()).toBe(0);
  });

  it("a delayed card request with the previous startedAt token cannot write into the restarted run", async () => {
    const previous = (await prisma.wave.findUniqueOrThrow({ where: { id: "leader-wave" } })).startedAt!.toISOString();
    await prisma.wave.update({ where: { id: "leader-wave" }, data: { status: "pending", startedAt: null, endsAt: null } });
    const restarted = await prisma.wave.update({ where: { id: "leader-wave" }, data: {
      status: "running", startedAt: new Date(Date.now() - 5_000), endsAt: new Date(Date.now() + 75 * 60_000 - 5_000),
    } });
    const input = { teamId: "t1", zoneId: zones[0], values: { [inputs[0]]: 77 }, autosave: true };
    env.actor.current = leader;
    expect(await saveZoneScore({ ...input, waveStartedAt: previous })).toEqual({ ok: false, error: "WAVE_RESTARTED" });
    expect(await prisma.score.count()).toBe(0);
    expect(await prisma.scoreAudit.count()).toBe(0);
    expect(await saveZoneScore({ ...input, waveStartedAt: restarted.startedAt!.toISOString() })).toMatchObject({ ok: true });
    expect(await value()).toBe(77);
  });

  it("rechecks a removed leader post after waiting for Wave", async () => {
    expect(await whileWaiting((tx) => tx.zoneStaff.delete({ where: { zoneId_userId: { zoneId: zones[0], userId: leader.id } } })))
      .toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await prisma.score.count()).toBe(0);
    expect(await prisma.scoreAudit.count()).toBe(0);
  });

  it("loads real stored roles again after role revocation during the lock wait", async () => {
    expect(await whileWaiting((tx) => tx.userAccessRole.deleteMany({ where: { userId: leader.id } })))
      .toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await loadPermissions(leader.id, "organiser")).not.toContain("judgeSheet.leaderView");
    expect(await prisma.score.count()).toBe(0);
    expect(await prisma.scoreAudit.count()).toBe(0);
  });

  it("an individual score-entry lock applied during the wait wins over the role", async () => {
    expect(await whileWaiting((tx) => tx.user.update({ where: { id: leader.id }, data: {
      permissionOverrides: { grant: [], deny: ["scores.enter"] },
    } }))).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await prisma.score.count()).toBe(0);
    expect(await prisma.scoreAudit.count()).toBe(0);
  });

  it("a queued judge and leader submission commit exactly one winner and protect its score", async () => {
    let judgeWrite: ReturnType<typeof save> | undefined;
    let leaderWrite: ReturnType<typeof save> | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Wave WHERE id = ${"leader-wave"} FOR UPDATE`;
      judgeWrite = save(judge, 25, true);
      await waitForLocks("Wave");
      leaderWrite = save(leader, 75, true);
      await waitForLocks("Wave", 2);
    }, { timeout: 15_000 });
    const results = await Promise.all([judgeWrite!, leaderWrite!]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "SCORE_LOCKED" }]);
    const winner = results[0].ok ? judge : leader;
    expect(await value()).toBe(results[0].ok ? 25 : 75);
    const score = await prisma.score.findUniqueOrThrow({ where: { teamId: "t1" } });
    expect(score.status).toBe("draft"); // Other zones still need their own submission.
    expect(await prisma.zoneScore.findUniqueOrThrow({ where: { scoreId_zoneId: { scoreId: score.id, zoneId: zones[0] } } }))
      .toMatchObject({ status: "submitted", submittedById: winner.id });
    expect(await save(leader, 500)).toEqual({ ok: false, error: "SCORE_LOCKED" });
    expect(await prisma.scoreAudit.count({ where: { scoreId: score.id } })).toBe(1);
  });

  it("real writes return strictly increasing stored revisions, including Submit and BFT unlock", async () => {
    // Pin Date.now to expose two writes occurring in the same millisecond.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
    try {
      const first = await save(leader, 50);
      const second = await save(judge, 51);
      expect(first).toMatchObject({ ok: true, revision: expect.any(String) });
      expect(second).toMatchObject({ ok: true, revision: expect.any(String) });
      if (!first.ok || !first.revision || !second.ok || !second.revision) throw new Error("Expected successful revision-bearing autosaves");
      expect(Date.parse(second.revision)).toBeGreaterThan(Date.parse(first.revision));
      expect((await prisma.score.findUniqueOrThrow({ where: { teamId: "t1" } })).updatedAt.toISOString()).toBe(second.revision);

      const submitted = await save(leader, 52, true);
      expect(submitted).toMatchObject({ ok: true, revision: expect.any(String) });
      if (!submitted.ok || !submitted.revision) throw new Error("Expected a revision-bearing submission");
      expect(Date.parse(submitted.revision)).toBeGreaterThan(Date.parse(second.revision));
      expect((await prisma.score.findUniqueOrThrow({ where: { teamId: "t1" } })).updatedAt.toISOString()).toBe(submitted.revision);
      env.actor.current = actors.hq;
      expect(await unlockScore("t1")).toMatchObject({ ok: true });
      const unlocked = await prisma.score.findUniqueOrThrow({ where: { teamId: "t1" }, include: { zones: true } });
      expect(unlocked.updatedAt.getTime()).toBeGreaterThan(Date.parse(submitted.revision));
      expect(unlocked.zones.every((zone) => zone.status === "draft")).toBe(true);

      const corrected = await save(leader, 53);
      expect(corrected).toMatchObject({ ok: true, revision: expect.any(String) });
      if (!corrected.ok || !corrected.revision) throw new Error("Expected a revision-bearing post-unlock autosave");
      expect(Date.parse(corrected.revision)).toBeGreaterThan(unlocked.updatedAt.getTime());
      expect((await prisma.score.findUniqueOrThrow({ where: { teamId: "t1" } })).updatedAt.toISOString()).toBe(corrected.revision);
      expect(await value()).toBe(53);
    } finally { clock.mockRestore(); }
  });

  it("a closure while waiting for Team is rechecked after both locks", async () => {
    let write: ReturnType<typeof save> | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Team WHERE id = ${"t1"} FOR UPDATE`;
      write = save(leader, 33);
      await waitForLocks("Team");
      // Series updates do not require Wave; the writer must re-read its cut-off after Team.
      await tx.series.update({ where: { id: "s1" }, data: { scoreEntryClosesAt: new Date(Date.now() - 1_000) } });
    }, { timeout: 15_000 });
    expect(await write!).toEqual({ ok: false, error: "SCORE_ENTRY_CLOSED" });
    expect(await prisma.score.count()).toBe(0);
  });

  it("migration appends missing keys, preserves role customizations and personal locks, and is idempotent", async () => {
    await prisma.accessRole.update({ where: { key: "zone-leaders" }, data: {
      permissions: ["competitions.view", "waves.view", "zoneStaff.manage", "scores.enter"],
    } });
    const overrides = { grant: ["overview.view"], deny: ["scores.enter", "judgeSheet.leaderView"] };
    await prisma.user.update({ where: { id: leader.id }, data: { permissionOverrides: overrides } });
    const sql = await readFile("prisma/migrations/20261003120000_zone_leader_score_entry/migration.sql", "utf8");
    const statements = sql.replace(/--[^\n]*/g, "").split(";").map((part) => part.trim()).filter(Boolean);
    for (const repetition of [1, 2]) {
      for (const statement of statements) await prisma.$executeRawUnsafe(statement);
      const role = await prisma.accessRole.findUniqueOrThrow({ where: { key: "zone-leaders" } });
      expect(role.permissions, `migration pass ${repetition}`).toEqual([
        "competitions.view", "waves.view", "zoneStaff.manage", "scores.enter", "judgeSheet.leaderView",
      ]);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: leader.id } })).permissionOverrides).toEqual(overrides);
      const effective = await loadPermissions(leader.id, "organiser");
      expect(effective).toContain("overview.view");
      expect(effective).not.toContain("scores.enter");
      expect(effective).not.toContain("judgeSheet.leaderView");
    }
    expect((await prisma.accessRole.findUniqueOrThrow({ where: { key: "judge" } })).permissions)
      .toEqual(["judgeSheet.view", "scores.enter"]);
  });
});
