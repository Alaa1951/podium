/**
 * CHANGING WHO IS ON A TEAM, AGAINST A REAL DATABASE (release R2b).
 *
 * Drives membership-change.ts (the athlete: replace, fill, leave),
 * staff-membership.ts (staff: swap, edit) and link-seats.ts (a sign-in
 * claiming a seat) against a throwaway schema built from the project's
 * migrations. Races are CONTROLLED: a holder takes the competition lock, the
 * requests start, the test waits until the database shows them queued on it,
 * then releases — both sides are provably in flight together.
 *
 * Skipped unless INTEGRATION_DB=1, and refuses anything but localhost:
 *
 *   INTEGRATION_DB=1 npx vitest run src/lib/membership.integration.test.ts
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const enabled = vi.hoisted(() => {
  const on = process.env.INTEGRATION_DB === "1";
  if (on) {
    try { process.loadEnvFile(".env"); } catch { /* DATABASE_URL must already be set */ }
  }
  process.env.NEXTAUTH_SECRET ||= "integration-test-secret";
  // Skipped runs still import the modules, and the Prisma module wants a URL
  // at import time; it is never connected to when the suite is skipped.
  if (!on) process.env.DATABASE_URL ||= "mysql://skipped@127.0.0.1:1/skipped";
  return on;
});

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import * as mariadb from "mariadb";
import { linkSeatsForUser } from "@/lib/link-seats";
import { changeMembership, type MembershipInput } from "@/lib/membership-change";
import { editRegistration, swapSeat } from "@/lib/staff-membership";

void spawn;
const base = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const schema = "pudem_mem_" + randomUUID().replaceAll("-", "").slice(0, 12);
let schemaUrl: URL;
let prisma: PrismaClient;
let admin: PrismaClient;

const HOLD = { INCOMPLETE_TEAM_POLICY: "hold" } as unknown as NodeJS.ProcessEnv;
const OFF = {} as unknown as NodeJS.ProcessEnv;
const sara = { id: "u-sara", email: "sara@example.com" };
const mona = { id: "u-mona", email: "mona@example.com" };
/** BFT MENA Full access, BFT MENA Partial access, and a gym. */
const staff = { id: "u-staff", role: "admin" as const, studioId: null, permissions: [] as never[] };
const desk = { id: "u-desk", role: "staff" as const, studioId: null, permissions: ["registrations.edit", "registrations.pair"] as never[] };
const gym = { id: "u-gym", role: "studio" as const, studioId: "studio-a", permissions: ["registrations.edit", "registrations.pair"] as never[] };

async function ddl(sql: string) {
  const conn = await mariadb.createConnection(schemaUrl.toString().replace(/^mysql:/, "mariadb:"));
  try { await conn.query(sql); } finally { await conn.end(); }
}

async function hold(work: (tx: Prisma.TransactionClient) => Promise<void>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let taken!: () => void;
  const holding = new Promise<void>((resolve) => { taken = resolve; });
  const done = prisma.$transaction(async (tx) => { await work(tx); taken(); await gate; }, { timeout: 60_000 });
  await holding;
  return { release: async () => { release(); await done; } };
}

async function waitForLockWaits(count: number) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    const [row] = await admin.$queryRawUnsafe<{ n: bigint | number }[]>(
      `SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE DB = '${schema}' AND COMMAND IN ('Query', 'Execute') AND INFO LIKE '%FOR UPDATE%'`
    );
    if (Number(row.n) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`expected ${count} request(s) queued on the held lock — they never got there together`);
}
const holdSeries = () => hold(async (tx) => { await tx.$queryRaw`SELECT id FROM Series WHERE id = ${"s1"} FOR UPDATE`; });

const op = () => randomUUID();
const replace = (over: Partial<Extract<MembershipInput, { kind: "replace" }>> = {}): MembershipInput => ({
  kind: "replace", operationId: op(), teamId: "t1", expectedVersion: 0, targetSeatId: "seat-mona",
  expected: { userId: "u-mona", email: "mona@example.com" }, fullName: "Nour Hassan", email: "nour@example.com", ...over,
});
const leave = (over: Partial<Extract<MembershipInput, { kind: "leave" }>> = {}): MembershipInput => ({
  kind: "leave", operationId: op(), teamId: "t1", expectedVersion: 0, mySeatId: "seat-mona", ...over,
});

const participant = (userId: string) => prisma.seriesParticipant.findUnique({ where: { seriesId_userId: { seriesId: "s1", userId } } });
const seat = (id: string) => prisma.competitor.findUnique({ where: { id } });
const teamRow = () => prisma.team.findUniqueOrThrow({ where: { id: "t1" }, select: { membershipVersion: true, ownership: true, registrantEmail: true, registrantUserId: true } });

describe.skipIf(!enabled)("team membership on a real database", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    if (!base || !["localhost", "127.0.0.1", "::1"].includes(base.hostname)) throw new Error("LOCAL_DATABASE_ONLY");
    admin = new PrismaClient({ adapter: new PrismaMariaDb(base.toString()) });
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    schemaUrl = new URL(base.toString());
    schemaUrl.pathname = `/${schema}`;
    const migrate = spawnSync("npx prisma migrate deploy", { shell: true, encoding: "utf8", env: { ...process.env, DATABASE_URL: schemaUrl.toString() } });
    if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(schemaUrl.toString()) });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${schema}\``);
      await admin.$disconnect();
    }
  });

  /**
   * FALCONS: Mona in SEAT 1 (signed in), Sara in SEAT 2 — Sara registered it.
   * Both are linked as each other's partner. Nour has an account, not entered.
   */
  beforeEach(async () => {
    await ddl("DROP TRIGGER IF EXISTS fail_audit");
    await prisma.membershipOperation.deleteMany();
    await prisma.adminAuditLog.deleteMany();
    await prisma.waveChangeRequest.deleteMany();
    await prisma.score.deleteMany();
    await prisma.competitor.deleteMany();
    await prisma.team.deleteMany();
    await prisma.wave.deleteMany();
    await prisma.seriesParticipant.deleteMany();
    await prisma.series.deleteMany();
    await prisma.user.deleteMany();
    await prisma.studio.deleteMany();
    await prisma.studio.create({ data: { id: "studio-a", name: "Studio A" } });
    await prisma.series.create({ data: { id: "s1", name: "Series", slug: "series", competitionDate: new Date(Date.now() + 10 * 86_400_000), status: "scheduled" } });
    for (const [id, email, role] of [["u-sara", "sara@example.com", "competitor"], ["u-mona", "mona@example.com", "competitor"], ["u-nour", "nour@example.com", "competitor"], ["u-staff", "hq@example.com", "admin"], ["u-desk", "desk@example.com", "staff"], ["u-gym", "gym@example.com", "studio"]] as const) {
      await prisma.user.create({ data: { id, email, name: id.slice(2), role, status: "active", approvalStatus: "approved", verifiedEmail: email } });
    }
    await prisma.team.create({
      data: {
        id: "t1", seriesId: "s1", number: 7, name: "FALCONS", category: "Womens", division: "Open", paymentStatus: "paid", studioId: "studio-a",
        ownership: "registrant", registrantEmail: "sara@example.com", registrantUserId: "u-sara",
        competitors: { create: [
          { id: "seat-mona", position: 1, fullName: "Mona Saleh", normalizedName: "mona saleh", email: "mona@example.com", userId: "u-mona" },
          { id: "seat-sara", position: 2, fullName: "Sara Ali", normalizedName: "sara ali", email: "sara@example.com", userId: "u-sara" },
        ] },
      },
    });
    await prisma.seriesParticipant.create({ data: { seriesId: "s1", userId: "u-sara", lookingForPartner: false, teamName: "FALCONS", partnerUserId: "u-mona", partnerName: "Mona Saleh", partnerEmail: "mona@example.com" } });
    await prisma.seriesParticipant.create({ data: { seriesId: "s1", userId: "u-mona", lookingForPartner: false, teamName: "FALCONS", partnerUserId: "u-sara", partnerName: "Sara Ali", partnerEmail: "sara@example.com" } });
  });

  // ── Replace ───────────────────────────────────────────────────────────────

  it("the registrant — in SEAT 2 — replaces her partner; both sides stay consistent through later sign-ins", async () => {
    expect(await changeMembership(prisma, sara, replace(), { env: OFF })).toMatchObject({ ok: true, code: "REPLACED", version: 1 });

    expect(await seat("seat-mona")).toMatchObject({ fullName: "Nour Hassan", email: "nour@example.com", userId: null, position: 1 });
    expect(await teamRow()).toMatchObject({ membershipVersion: 1, ownership: "registrant", registrantEmail: "sara@example.com" });
    expect(await participant("u-mona")).toMatchObject({ partnerUserId: null, partnerEmail: null, partnerName: null, lookingForPartner: true, teamName: null });
    expect(await participant("u-sara")).toMatchObject({ partnerUserId: null, partnerName: "Nour Hassan", partnerEmail: "nour@example.com" });
    expect(await prisma.adminAuditLog.count({ where: { action: "team.partner_replaced", targetId: "t1" } })).toBe(1);
    expect(await prisma.membershipOperation.count()).toBe(1);

    // Mona signs in again: nothing links her back.
    expect(await linkSeatsForUser(prisma, "u-mona")).toMatchObject({ linked: 0 });
    expect(await prisma.competitor.count({ where: { userId: "u-mona" } })).toBe(0);
    // Nour signs in (her address is proven): the seat is hers, and the pair points at each other.
    expect(await linkSeatsForUser(prisma, "u-nour")).toMatchObject({ linked: 1 });
    expect(await seat("seat-mona")).toMatchObject({ userId: "u-nour" });
    expect(await participant("u-sara")).toMatchObject({ partnerUserId: "u-nour" });
    expect(await participant("u-nour")).toMatchObject({ partnerUserId: "u-sara", lookingForPartner: false, teamName: "FALCONS" });
    expect(await participant("u-mona")).toMatchObject({ partnerUserId: null, lookingForPartner: true });
  });

  it("the registrant in SEAT 1 works the same way — position means nothing", async () => {
    await prisma.competitor.update({ where: { id: "seat-mona" }, data: { position: 3 } });
    await prisma.competitor.update({ where: { id: "seat-sara" }, data: { position: 1 } });
    await prisma.competitor.update({ where: { id: "seat-mona" }, data: { position: 2 } });
    expect(await changeMembership(prisma, sara, replace(), { env: OFF })).toMatchObject({ ok: true, code: "REPLACED" });
    expect(await seat("seat-mona")).toMatchObject({ position: 2, email: "nour@example.com" });
  });

  it("nobody else may: the partner, a stranger, an unconfirmed or a joint team", async () => {
    expect(await changeMembership(prisma, mona, replace({ targetSeatId: "seat-sara", expected: { userId: "u-sara", email: "sara@example.com" } }), { env: OFF })).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await changeMembership(prisma, { id: "u-nour", email: "nour@example.com" }, replace(), { env: OFF })).toEqual({ ok: false, error: "NOT_ON_TEAM" });
    await prisma.team.update({ where: { id: "t1" }, data: { ownership: "unknown", registrantEmail: null, registrantUserId: null } });
    expect(await changeMembership(prisma, sara, replace(), { env: OFF })).toEqual({ ok: false, error: "OWNERSHIP_UNKNOWN" });
    await prisma.team.update({ where: { id: "t1" }, data: { ownership: "joint" } });
    expect(await changeMembership(prisma, sara, replace(), { env: OFF })).toEqual({ ok: false, error: "JOINT_TEAM" });
    expect(await seat("seat-mona")).toMatchObject({ userId: "u-mona", email: "mona@example.com" });
  });

  // ── Not confirmed by BFT MENA: the automatic registrant ───────────────────

  it("not confirmed, only one signed in: she replaces her partner, becomes the registrant (audited), and keeps the team once the newcomer signs in", async () => {
    await prisma.competitor.update({ where: { id: "seat-mona" }, data: { userId: null } });
    await prisma.team.update({ where: { id: "t1" }, data: { ownership: "unknown", registrantEmail: null, registrantUserId: null } });
    expect(await changeMembership(prisma, sara, replace({ expected: { userId: null, email: "mona@example.com" } }), { env: OFF })).toMatchObject({ ok: true, code: "REPLACED", version: 1 });
    expect(await seat("seat-mona")).toMatchObject({ fullName: "Nour Hassan", email: "nour@example.com", userId: null });
    expect(await teamRow()).toMatchObject({ membershipVersion: 1, ownership: "registrant", registrantEmail: "sara@example.com", registrantUserId: "u-sara" });
    const claim = await prisma.adminAuditLog.findFirst({ where: { action: "team.ownership_changed", targetId: "t1" } });
    expect(claim).toMatchObject({ actorId: "u-sara" });
    expect(claim?.detail).toContain("the only member signed in");
    expect(await prisma.adminAuditLog.count({ where: { action: "team.partner_replaced", targetId: "t1" } })).toBe(1);

    // Nour signs in: both are signed in now, and the team is still Sara's.
    expect(await linkSeatsForUser(prisma, "u-nour")).toMatchObject({ linked: 1 });
    const nour = { id: "u-nour", email: "nour@example.com" };
    const version = (await teamRow()).membershipVersion;
    expect(await changeMembership(prisma, nour, replace({ expectedVersion: version, targetSeatId: "seat-sara", expected: { userId: "u-sara", email: "sara@example.com" }, fullName: "Lina Omar", email: "lina@example.com" }), { env: OFF })).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await seat("seat-sara")).toMatchObject({ userId: "u-sara", email: "sara@example.com" });
  });

  it("not confirmed, a CRM team: the payer manages it — her partner cannot replace her, she can replace him", async () => {
    await prisma.team.update({ where: { id: "t1" }, data: { ownership: "unknown", registrantEmail: null, registrantUserId: null, source: "ghl", externalId: "crm-1", rawPayload: { email: "Sara@Example.com" } } });
    expect(await changeMembership(prisma, mona, replace({ targetSeatId: "seat-sara", expected: { userId: "u-sara", email: "sara@example.com" } }), { env: OFF })).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await teamRow()).toMatchObject({ membershipVersion: 0, ownership: "unknown" });
    expect(await changeMembership(prisma, sara, replace(), { env: OFF })).toMatchObject({ ok: true, code: "REPLACED", version: 1 });
    expect(await teamRow()).toMatchObject({ ownership: "registrant", registrantEmail: "sara@example.com", registrantUserId: "u-sara" });
    expect((await prisma.adminAuditLog.findFirst({ where: { action: "team.ownership_changed", targetId: "t1" } }))?.detail).toContain("the CRM payer");
  });

  it("not confirmed and both signed in, no payer: nobody — until BFT MENA chooses", async () => {
    await prisma.team.update({ where: { id: "t1" }, data: { ownership: "unknown", registrantEmail: null, registrantUserId: null } });
    expect(await changeMembership(prisma, sara, replace(), { env: OFF })).toEqual({ ok: false, error: "OWNERSHIP_UNKNOWN" });
    expect(await changeMembership(prisma, mona, replace({ targetSeatId: "seat-sara", expected: { userId: "u-sara", email: "sara@example.com" } }), { env: OFF })).toEqual({ ok: false, error: "OWNERSHIP_UNKNOWN" });
    expect(await teamRow()).toMatchObject({ membershipVersion: 0, ownership: "unknown" });
  });

  it("refuses somebody already entered, yourself, and a page whose partner or version is out of date", async () => {
    await prisma.team.create({ data: { id: "t2", seriesId: "s1", number: 8, name: "OTHER", category: "Womens", division: "Open", competitors: { create: [{ position: 1, fullName: "Nour Hassan", normalizedName: "nour hassan", email: "nour@example.com" }] } } });
    expect(await changeMembership(prisma, sara, replace(), { env: OFF })).toEqual({ ok: false, error: "ALREADY_ENTERED" });
    expect(await changeMembership(prisma, sara, replace({ email: "sara@example.com" }), { env: OFF })).toEqual({ ok: false, error: "PARTNER_IS_YOU" });
    expect(await changeMembership(prisma, sara, replace({ email: "lina@example.com", expected: { userId: null, email: "mona@example.com" } }), { env: OFF })).toEqual({ ok: false, error: "STALE_MEMBERSHIP" });
    expect(await changeMembership(prisma, sara, replace({ email: "lina@example.com", expectedVersion: 5 }), { env: OFF })).toEqual({ ok: false, error: "STALE_MEMBERSHIP" });
  });

  // ── Repeats ───────────────────────────────────────────────────────────────

  it("the same request twice is done once; the same id with other content, or from somebody else, is refused", async () => {
    const request = replace({ email: "lina@example.com", fullName: "Lina Omar" });
    expect(await changeMembership(prisma, sara, request, { env: OFF })).toMatchObject({ ok: true, code: "REPLACED", version: 1, replayed: false });
    expect(await changeMembership(prisma, sara, request, { env: OFF })).toMatchObject({ ok: true, code: "REPLACED", version: 1, replayed: true });
    expect((await teamRow()).membershipVersion).toBe(1);
    expect(await changeMembership(prisma, sara, { ...request, email: "other@example.com" } as MembershipInput, { env: OFF })).toEqual({ ok: false, error: "OPERATION_MISMATCH" });
    expect(await changeMembership(prisma, mona, request, { env: OFF })).toEqual({ ok: false, error: "OPERATION_MISMATCH" });
    expect(await prisma.adminAuditLog.count({ where: { action: "team.partner_replaced" } })).toBe(1);
  });

  it("the same request sent twice AT ONCE: one change, the other gets the same answer", async () => {
    const request = replace({ email: "lina@example.com", fullName: "Lina Omar" });
    const holder = await holdSeries();
    const first = changeMembership(prisma, sara, request, { env: OFF });
    const second = changeMembership(prisma, sara, request, { env: OFF });
    await waitForLockWaits(2);
    await holder.release();
    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.ok && r.code)).toEqual(["REPLACED", "REPLACED"]);
    expect(results.filter((r) => r.ok && r.replayed)).toHaveLength(1);
    expect((await teamRow()).membershipVersion).toBe(1);
  });

  // ── Leave and fill ────────────────────────────────────────────────────────

  it("leaving waits for the incomplete-team policy; with it, the partner leaves and the registrant can fill the seat", async () => {
    expect(await changeMembership(prisma, mona, leave(), { env: OFF })).toEqual({ ok: false, error: "LEAVE_NOT_AVAILABLE" });
    expect(await changeMembership(prisma, sara, leave({ mySeatId: "seat-sara" }), { env: HOLD })).toEqual({ ok: false, error: "NOT_ALLOWED" }); // the registrant cannot leave

    expect(await changeMembership(prisma, mona, leave(), { env: HOLD })).toMatchObject({ ok: true, code: "LEFT", version: 1 });
    expect(await seat("seat-mona")).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: "u-mona" } })).not.toBeNull(); // her account stays
    expect(await participant("u-mona")).toMatchObject({ partnerUserId: null, partnerEmail: null, lookingForPartner: true, teamName: null });
    expect(await participant("u-sara")).toMatchObject({ partnerUserId: null, partnerName: null, partnerEmail: null });
    expect(await linkSeatsForUser(prisma, "u-mona")).toMatchObject({ linked: 0 }); // no way back in by signing in

    const fill: MembershipInput = { kind: "fill", operationId: op(), teamId: "t1", expectedVersion: 1, fullName: "Nour Hassan", email: "nour@example.com" };
    expect(await changeMembership(prisma, sara, fill, { env: HOLD })).toMatchObject({ ok: true, code: "FILLED", version: 2 });
    expect(await prisma.competitor.findFirst({ where: { teamId: "t1", email: "nour@example.com" } })).toMatchObject({ position: 1, userId: null });
  });

  // ── Audit ─────────────────────────────────────────────────────────────────

  it("a change whose audit line cannot be written does not happen at all", async () => {
    await ddl("CREATE TRIGGER fail_audit BEFORE INSERT ON AdminAuditLog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit refused (test)'");
    await expect(changeMembership(prisma, sara, replace(), { env: OFF })).rejects.toThrow();
    await expect(swapSeat(prisma, staff, { competitorId: "seat-mona", fullName: "Nour Hassan", email: "nour@example.com" })).rejects.toThrow();
    await ddl("DROP TRIGGER fail_audit");
    expect(await seat("seat-mona")).toMatchObject({ userId: "u-mona", email: "mona@example.com" });
    expect(await teamRow()).toMatchObject({ membershipVersion: 0 });
    expect(await prisma.membershipOperation.count()).toBe(0);
    expect(await participant("u-mona")).toMatchObject({ partnerUserId: "u-sara" });
  });

  // ── Races, both sides provably in flight ──────────────────────────────────

  it("replace and leave at once: exactly one happens; the other is told the team changed", async () => {
    const holder = await holdSeries();
    const a = changeMembership(prisma, sara, replace(), { env: HOLD });
    const b = changeMembership(prisma, mona, leave(), { env: HOLD });
    await waitForLockWaits(2);
    await holder.release();
    const results = await Promise.all([a, b]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: "STALE_MEMBERSHIP" });
    expect((await teamRow()).membershipVersion).toBe(1);
    expect(await participant("u-mona")).toMatchObject({ partnerUserId: null, lookingForPartner: true });
  });

  it.each(["leave first", "replace first"] as const)("whichever lands first (%s), the other page is told the team changed", async (order) => {
    const doLeave = () => changeMembership(prisma, mona, leave(), { env: HOLD });
    const doReplace = () => changeMembership(prisma, sara, replace(), { env: HOLD });
    const [first, second] = order === "leave first" ? [doLeave, doReplace] : [doReplace, doLeave];
    expect(await first()).toMatchObject({ ok: true, version: 1 });
    expect(await second()).toEqual({ ok: false, error: "STALE_MEMBERSHIP" });
  });

  it("athlete replace and a staff swap at once, on the same page version: one wins, the other is stale", async () => {
    const holder = await holdSeries();
    const athlete = changeMembership(prisma, sara, replace(), { env: OFF });
    const desk = swapSeat(prisma, staff, { competitorId: "seat-mona", fullName: "Lina Omar", email: "lina@example.com", expectedVersion: 0 });
    await waitForLockWaits(2);
    await holder.release();
    const [a, b] = await Promise.all([athlete, desk]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(!a.ok ? a.error : !b.ok ? b.error : null).toBe("STALE_MEMBERSHIP");
    expect((await teamRow()).membershipVersion).toBe(1);
  });

  it("a replacement racing the old partner's FIRST sign-in claim: never both — no one is linked to a seat now carrying someone else", async () => {
    // Mona has not claimed her seat yet (it carries her email, no account).
    await prisma.competitor.update({ where: { id: "seat-mona" }, data: { userId: null } });
    await prisma.seriesParticipant.deleteMany({ where: { userId: "u-mona" } });
    const holder = await holdSeries();
    const claim = linkSeatsForUser(prisma, "u-mona");
    const swap = changeMembership(prisma, sara, replace({ expected: { userId: null, email: "mona@example.com" } }), { env: OFF });
    await waitForLockWaits(2);
    await holder.release();
    const [claimed, replaced] = await Promise.all([claim, swap]);
    const after = await seat("seat-mona");
    if (replaced.ok) {
      expect(claimed.linked).toBe(0);
      expect(after).toMatchObject({ email: "nour@example.com", userId: null });
    } else {
      expect(replaced).toEqual({ ok: false, error: "STALE_MEMBERSHIP" });
      expect(claimed.linked).toBe(1);
      expect(after).toMatchObject({ email: "mona@example.com", userId: "u-mona" });
    }
  });

  // ── Staff edits are corrections, never disguised swaps ────────────────────

  it("below Full access, a registration edit cannot change a signed-in seat's email, or put a different person in a seat", async () => {
    const form = (monaPart: object) => ({
      teamId: "t1", teamName: "FALCONS", category: "Womens" as const, division: "Open" as const,
      one: { id: "seat-mona", fullName: "Mona Saleh", email: "mona@example.com", phone: null, dateOfBirth: null, studioId: null, ...monaPart },
      two: { id: "seat-sara", fullName: "Sara Ali", email: "sara@example.com", phone: null, dateOfBirth: null, studioId: null },
    });
    expect(await editRegistration(prisma, desk, form({ email: "mona.new@example.com" }))).toEqual({ ok: false, error: "LINKED_SEAT_EMAIL" });
    expect(await editRegistration(prisma, desk, form({ fullName: "Nour Hassan", email: "nour@example.com" }))).toEqual({ ok: false, error: "LINKED_SEAT_EMAIL" });
    expect(await seat("seat-mona")).toMatchObject({ userId: "u-mona", email: "mona@example.com" });

    // A name correction is fine, audited, and does not move the version.
    expect(await editRegistration(prisma, staff, form({ fullName: "Mona A. Saleh" }))).toEqual({ ok: true });
    expect(await teamRow()).toMatchObject({ membershipVersion: 0 });
    expect(await participant("u-sara")).toMatchObject({ partnerName: "Mona A. Saleh" });
    expect(await prisma.adminAuditLog.count({ where: { action: "registration.updated" } })).toBe(1);
  });

  it("Full access corrects a signed-in athlete's email and name — the same athlete, their sign-in email with it", async () => {
    const form = (saraPart: object, over: object = {}) => ({
      teamId: "t1", teamName: "FALCONS", category: "Womens" as const, division: "Open" as const,
      one: { id: "seat-mona", fullName: "Mona Saleh", email: "mona@example.com", phone: null, dateOfBirth: null, studioId: null },
      two: { id: "seat-sara", fullName: "Sara Ali", email: "sara@example.com", phone: null, dateOfBirth: null, studioId: null, ...saraPart },
      ...over,
    });
    // Only on the tick; another account's address never; nothing written until then.
    expect(await editRegistration(prisma, staff, form({ email: "sara.ali@example.com" }))).toEqual({ ok: false, error: "CONFIRM_ACCOUNT_EMAIL" });
    expect(await editRegistration(prisma, staff, form({ email: "mona@example.com" }, { confirmAccountEmail: true }))).toEqual({ ok: false, error: "ALREADY_ENTERED" });
    await prisma.user.create({ data: { id: "u-else", email: "else@example.com", name: "Else", role: "competitor", status: "active" } });
    expect(await editRegistration(prisma, staff, form({ email: "else@example.com" }, { confirmAccountEmail: true }))).toEqual({ ok: false, error: "ACCOUNT_EMAIL_TAKEN" });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: "u-sara" } })).toMatchObject({ email: "sara@example.com" });

    // Corrected: the same account, seat, registrant and version; the old proof spent.
    expect(await editRegistration(prisma, staff, form({ email: "Sara.Ali@example.com", fullName: "Sara M. Ali" }, { confirmAccountEmail: true }))).toEqual({ ok: true });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: "u-sara" } })).toMatchObject({ email: "sara.ali@example.com", name: "Sara M. Ali", verifiedEmail: null });
    expect(await seat("seat-sara")).toMatchObject({ userId: "u-sara", email: "sara.ali@example.com", fullName: "Sara M. Ali" });
    expect(await teamRow()).toMatchObject({ membershipVersion: 0, registrantUserId: "u-sara", registrantEmail: "sara.ali@example.com" });
    expect(await prisma.adminAuditLog.count({ where: { action: "account.updated", targetId: "u-sara" } })).toBe(1);
  });

  // ── D3a: the 24-hour cutoff, on real rows ─────────────────────────────────

  const START = new Date("2026-10-02T15:00:00Z");
  const CUTOFF = new Date("2026-10-01T15:00:00Z");
  const at = (offsetMs: number) => new Date(CUTOFF.getTime() + offsetMs);
  const editForm = (monaPart: object) => ({
    teamId: "t1", teamName: "FALCONS", category: "Womens" as const, division: "Open" as const,
    one: { id: "seat-mona", fullName: "Mona Saleh", email: "mona@example.com", phone: null, dateOfBirth: null, studioId: null, ...monaPart },
    two: { id: "seat-sara", fullName: "Sara Ali", email: "sara@example.com", phone: null, dateOfBirth: null, studioId: null },
  });

  it("before the cutoff everybody with the right may; at it and after, only Full access — athlete, gym and Partial access are closed", async () => {
    await prisma.series.update({ where: { id: "s1" }, data: { competitionDate: START } });
    // At the cutoff: the athlete, the gym, Partial access — all closed; nothing written.
    expect(await changeMembership(prisma, sara, replace(), { env: OFF, now: at(0) })).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
    expect(await editRegistration(prisma, gym, editForm({ fullName: "Mona A. Saleh" }), at(0))).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
    expect(await swapSeat(prisma, desk, { competitorId: "seat-mona", fullName: "Lina Omar", email: "lina@example.com" }, at(0))).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
    expect(await teamRow()).toMatchObject({ membershipVersion: 0 });
    // One millisecond before: the gym's correction goes through.
    expect(await editRegistration(prisma, gym, editForm({ fullName: "Mona A. Saleh" }), at(-1))).toEqual({ ok: true });
    // After: Full access still may.
    expect(await swapSeat(prisma, staff, { competitorId: "seat-mona", fullName: "Lina Omar", email: "lina@example.com" }, at(3_600_000))).toMatchObject({ ok: true, changed: true });
    expect(await seat("seat-mona")).toMatchObject({ email: "lina@example.com", userId: null });
  });

  // ── Adding or re-identifying a seat against the floor's barriers ─────────

  it.each([
    ["after the competition is finished", async () => { await prisma.series.update({ where: { id: "s1" }, data: { status: "final" } }); }, "SERIES_FINISHED"],
    ["once the team has a score", async () => { await prisma.score.create({ data: { teamId: "t1" } }); }, "TEAM_ALREADY_SCORED"],
    ["after its wave has started", async () => {
      const wave = await prisma.wave.create({ data: { seriesId: "s1", number: 1, status: "running", startedAt: new Date() } });
      await prisma.team.update({ where: { id: "t1" }, data: { waveId: wave.id } });
    }, "WAVE_STARTED"],
  ])("nobody adds a seat %s, and below Full access nobody changes a seat's email — Full access corrects one; a name fix goes through", async (_label, setUp, error) => {
    // Mona leaves the seat free first (a one-seat team), then the barrier.
    await prisma.competitor.update({ where: { id: "seat-mona" }, data: { userId: null } });
    await setUp();
    // Below Full access, the unclaimed seat's new email = a different person.
    expect(await editRegistration(prisma, desk, editForm({ email: "nour@example.com" }))).toEqual({ ok: false, error });
    // Full access corrects the same athlete's address: nothing about the seat is cleared.
    expect(await editRegistration(prisma, staff, editForm({ email: "mona.s@example.com" }))).toEqual({ ok: true });
    expect(await seat("seat-mona")).toMatchObject({ email: "mona.s@example.com", fullName: "Mona Saleh" });
    // Adding a seat to a one-seat team.
    await prisma.competitor.delete({ where: { id: "seat-mona" } });
    const add = { ...editForm({}), one: { id: "seat-sara", fullName: "Sara Ali", email: "sara@example.com", phone: null, dateOfBirth: null, studioId: null }, two: { fullName: "Nour Hassan", email: "nour@example.com", phone: null, dateOfBirth: null, studioId: null } };
    expect(await editRegistration(prisma, staff, add)).toEqual({ ok: false, error });
    expect(await prisma.competitor.count({ where: { teamId: "t1" } })).toBe(1);
    // A correction of a name is not a membership change.
    expect(await editRegistration(prisma, staff, { ...add, two: undefined, one: { ...add.one, fullName: "Sara A. Ali" } })).toEqual({ ok: true });
  });

  // ── An email is who a seat is: the review's two requests, staff side ─────

  it("a new email on an unclaimed seat (name unchanged) is a new person: the old one's phone, portrait and date of birth go; a later name change is only a name", async () => {
    await prisma.competitor.update({ where: { id: "seat-mona" }, data: { userId: null, phone: "+97450000001", photoPath: "/portraits/mona.webp", dateOfBirth: new Date("1995-01-01") } });
    expect(await editRegistration(prisma, gym, { ...editForm({ email: "nour@example.com", phone: "+97450000001", dateOfBirth: new Date("1995-01-01") }) })).toEqual({ ok: true });
    expect(await seat("seat-mona")).toMatchObject({ email: "nour@example.com", fullName: "Mona Saleh", phone: null, photoPath: null, dateOfBirth: null, userId: null });
    expect(await teamRow()).toMatchObject({ membershipVersion: 1 });
    expect(await participant("u-sara")).toMatchObject({ partnerEmail: "nour@example.com" });
    expect(await prisma.adminAuditLog.count({ where: { action: "registration.updated", detail: { contains: "nour@example.com" } } })).toBe(1);

    // Second request: the name — a correction now, of the new person.
    expect(await editRegistration(prisma, gym, { ...editForm({ email: "nour@example.com", fullName: "Nour Hassan" }), expectedVersion: 1 })).toEqual({ ok: true });
    expect(await teamRow()).toMatchObject({ membershipVersion: 1 });
    // …and Mona, signing in again, is not linked back to anything.
    expect(await linkSeatsForUser(prisma, "u-mona")).toMatchObject({ linked: 0 });
  });

  it("an address already entered elsewhere, or already an account entered elsewhere, is refused", async () => {
    await prisma.competitor.update({ where: { id: "seat-mona" }, data: { userId: null } });
    await prisma.team.create({ data: { id: "t2", seriesId: "s1", number: 8, name: "OTHER", category: "Womens", division: "Open", competitors: { create: [{ position: 1, fullName: "Nour Hassan", normalizedName: "nour hassan", email: "nour.old@example.com", userId: "u-nour" }] } } });
    // Nour's ACCOUNT is on team 8 under an older address: her account email still finds it.
    expect(await editRegistration(prisma, staff, editForm({ email: "nour@example.com" }))).toEqual({ ok: false, error: "ALREADY_ENTERED" });
  });
});
