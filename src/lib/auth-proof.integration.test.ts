/**
 * THE PROOF RULE AND SEAT LINKING AGAINST A REAL DATABASE.
 *
 * Mocks cannot show that a row lock serialises a code being spent against an
 * email being changed, that two requests racing for one link cannot both
 * win, or that a failure halfway through linking leaves nothing behind. This
 * file builds a throwaway schema on the local MariaDB with the project's own
 * migrations, seeds a few rows, and drives auth-proof.ts and link-seats.ts.
 *
 * CONTROLLED CONCURRENCY. A race is only proven if both sides are really in
 * flight at once. So a "holder" transaction takes the contested lock first;
 * the requests are started; the test waits until the DATABASE reports them
 * queued on that lock (INNODB_TRX, state LOCK WAIT) — each has already done
 * its reads by then — and only then releases the holder.
 *
 * Skipped unless INTEGRATION_DB=1, and refuses anything but localhost:
 *
 *   INTEGRATION_DB=1 npx vitest run src/lib/auth-proof.integration.test.ts
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The modules under test read their secrets at import time, so the local
// .env is loaded before any of them (vi.hoisted runs ahead of the imports).
const enabled = vi.hoisted(() => {
  const on = process.env.INTEGRATION_DB === "1";
  if (on) {
    try { process.loadEnvFile(".env"); } catch { /* no .env: DATABASE_URL must already be set */ }
  }
  // The imports below need a secret even when the suite is skipped.
  process.env.NEXTAUTH_SECRET ||= "integration-test-secret";
  return on;
});

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import * as mariadb from "mariadb";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { consumeLoginCode, forgetAddressProof, spendAuthToken } from "@/lib/auth-proof";
import { linkSeatsForUser } from "@/lib/link-seats";
import { hashSecret } from "@/lib/security";

const base = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const schema = "pudem_int_" + randomUUID().replaceAll("-", "").slice(0, 12);
let prisma: PrismaClient;
let admin: PrismaClient;
let schemaUrl: URL;

/** DDL (triggers) cannot be prepared: send it over the plain text protocol. */
async function ddl(sql: string) {
  const conn = await mariadb.createConnection(schemaUrl.toString().replace(/^mysql:/, "mariadb:"));
  try { await conn.query(sql); } finally { await conn.end(); }
}

const codeRow = (userId: string, code: string, sentTo: string | null, extra: Record<string, unknown> = {}) => ({
  userId, codeHash: hashSecret(code), purpose: "login" as const, expiresAt: new Date(Date.now() + 600_000), sentTo, ...extra,
});
const tokenRow = (userId: string, token: string, purpose: "invite" | "reset", sentTo: string | null) => ({
  userId, tokenHash: hashSecret(token), purpose, expiresAt: new Date(Date.now() + 600_000), sentTo,
});

const FAIL_PARTICIPANT = "fail_participant_insert";

/**
 * Hold a lock in a transaction of its own until released. `work` takes the
 * lock (and may change rows); the returned promise settles when committed.
 */
async function hold(work: (tx: Prisma.TransactionClient) => Promise<void>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let taken!: () => void;
  const holding = new Promise<void>((resolve) => { taken = resolve; });
  const done = prisma.$transaction(async (tx) => {
    await work(tx);
    taken();
    await gate;
  }, { timeout: 60_000 });
  await holding;
  return { release: async () => { release(); await done; } };
}

/**
 * Wait until `count` connections on this schema are blocked in a locking
 * read (`… FOR UPDATE`) — i.e. queued behind the holder. (This MariaDB does
 * not list such waiters in INNODB_TRX; the process list shows them as a
 * statement still executing.)
 */
async function waitForLockWaits(count: number) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    const [row] = await admin.$queryRawUnsafe<{ n: bigint | number }[]>(
      // The schema name is generated here (letters, digits, underscore): safe to inline.
      `SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE DB = '${schema}' AND COMMAND IN ('Query', 'Execute') AND INFO LIKE '%FOR UPDATE%'`
    );
    if (Number(row.n) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`expected ${count} request(s) queued on the held lock — they never got there together`);
}

const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

/**
 * A code sign-in as the providers run it (auth-password.ts): the code is
 * spent and the address proven in one transaction; once that has committed,
 * the athlete's seats are linked in a transaction of their own.
 */
async function signInWithCode(userId: string, code: string) {
  const proof = await consumeLoginCode({ db: prisma, userId, code, purpose: "login", maxAttempts: 5 });
  return { proof, link: proof.ok ? await linkSeatsForUser(prisma, userId) : null };
}

describe.skipIf(!enabled)("address-bound proof and seat linking on a real database", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    if (!base || !["localhost", "127.0.0.1", "::1"].includes(base.hostname)) throw new Error("LOCAL_DATABASE_ONLY");
    admin = new PrismaClient({ adapter: new PrismaMariaDb(base.toString()) });
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const url = new URL(base.toString());
    url.pathname = `/${schema}`;
    schemaUrl = url;
    const migrate = spawnSync("npx prisma migrate deploy", { shell: true, encoding: "utf8", env: { ...process.env, DATABASE_URL: url.toString() } });
    if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(url.toString()) });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${schema}\``);
      await admin.$disconnect();
    }
  });

  beforeEach(async () => {
    await ddl(`DROP TRIGGER IF EXISTS ${FAIL_PARTICIPANT}`);
    await prisma.otpChallenge.deleteMany();
    await prisma.authToken.deleteMany();
    await prisma.partnerRequest.deleteMany();
    await prisma.competitor.deleteMany();
    await prisma.team.deleteMany();
    await prisma.seriesParticipant.deleteMany();
    await prisma.series.deleteMany();
    await prisma.user.deleteMany();
    await prisma.series.create({ data: { id: "s1", name: "Series", slug: "series", competitionDate: new Date("2026-10-02"), status: "scheduled" } });
    await prisma.series.create({ data: { id: "s-train", name: "Rehearsal", slug: "rehearsal", competitionDate: new Date("2026-09-30"), status: "scheduled", isTraining: true } });
    await prisma.user.create({ data: { id: "u1", email: "a@example.com", name: "Sara", role: "competitor", status: "active", approvalStatus: "pending" } });
    await prisma.team.create({
      data: {
        id: "t1", seriesId: "s1", number: 1, name: "FALCONS", category: "Womens", division: "Open", paymentStatus: "paid",
        competitors: { create: [{ id: "c1", position: 1, fullName: "Sara", normalizedName: "sara", email: "a@example.com" }, { id: "c2", position: 2, fullName: "Mona", normalizedName: "mona", email: "mona@example.com" }] },
      },
    });
  });

  // ── Codes and links: what is refused ─────────────────────────────────────

  it("T7c: a code sent to A is refused after the account moved to B — nothing written", async () => {
    await prisma.otpChallenge.create({ data: codeRow("u1", "111111", "a@example.com") });
    await prisma.user.update({ where: { id: "u1" }, data: { email: "b@example.com" } });
    const { proof: result, link } = await signInWithCode("u1", "111111");
    expect(result).toEqual({ ok: false, reason: "address_changed" });
    expect(link).toBeNull();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: "u1" } });
    expect(user.verifiedEmail).toBeNull();
    expect(user.approvalStatus).toBe("pending");
    expect((await prisma.competitor.findUniqueOrThrow({ where: { id: "c1" } })).userId).toBeNull();
    expect((await prisma.otpChallenge.findFirstOrThrow()).consumedAt).not.toBeNull(); // spent
  });

  it("T7c: a reset link sent to A is refused after the move — no password, no activation", async () => {
    await prisma.user.update({ where: { id: "u1" }, data: { status: "invited" } });
    await prisma.authToken.create({ data: tokenRow("u1", "tok-a", "reset", "a@example.com") });
    await prisma.user.update({ where: { id: "u1" }, data: { email: "b@example.com" } });
    let applied = false;
    const result = await spendAuthToken({ db: prisma, token: "tok-a", purpose: "reset", onProven: async () => { applied = true; } });
    expect(result).toEqual({ ok: false, reason: "address_changed" });
    expect(applied).toBe(false);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: "u1" } });
    expect(user.passwordHash).toBeNull();
    expect(user.status).toBe("invited");
    expect(user.verifiedEmail).toBeNull();
  });

  it("T7g: anything without a recipient is refused — invitation included — and a fresh link to the current address works", async () => {
    await prisma.otpChallenge.create({ data: codeRow("u1", "222222", null) });
    expect(await consumeLoginCode({ db: prisma, userId: "u1", code: "222222", purpose: "login", maxAttempts: 5 })).toEqual({ ok: false, reason: "no_recipient" });
    await prisma.authToken.create({ data: tokenRow("u1", "old-invite", "invite", null) });
    let applied = false;
    expect(await spendAuthToken({ db: prisma, token: "old-invite", purpose: "invite", onProven: async () => { applied = true; } })).toEqual({ ok: false, reason: "no_recipient" });
    expect(applied).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: "u1" } })).verifiedEmail).toBeNull();

    await prisma.authToken.create({ data: tokenRow("u1", "new-invite", "invite", "a@example.com") });
    // As set-password does: the password and activation with the proof, the seats after it.
    const ok = await spendAuthToken({ db: prisma, token: "new-invite", purpose: "invite", onProven: async (tx, user) => { await tx.user.update({ where: { id: user.id }, data: { passwordHash: "hash", status: "active" } }); } });
    expect(ok).toMatchObject({ ok: true, verifiedEmail: "a@example.com" });
    expect(await linkSeatsForUser(prisma, "u1")).toMatchObject({ linked: 1, approved: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: "u1" } });
    expect(user.verifiedEmail).toBe("a@example.com");
    expect(user.passwordHash).toBe("hash");
    expect(user.approvalStatus).toBe("approved"); // a paid seat was linked
    expect((await prisma.competitor.findUniqueOrThrow({ where: { id: "c1" } })).userId).toBe("u1");
  });

  it("T7f: an email change whose audit line cannot be written is rolled back whole", async () => {
    await prisma.otpChallenge.create({ data: codeRow("u1", "444444", "a@example.com") });
    await prisma.user.update({ where: { id: "u1" }, data: { verifiedEmail: "a@example.com" } });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM User WHERE id = ${"u1"} FOR UPDATE`;
        await tx.user.update({ where: { id: "u1" }, data: { email: "b@example.com" } });
        await forgetAddressProof(tx, "u1");
        throw new Error("audit write failed");
      })
    ).rejects.toThrow("audit write failed");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: "u1" } });
    expect(user.email).toBe("a@example.com");
    expect(user.verifiedEmail).toBe("a@example.com");
    expect((await prisma.otpChallenge.findFirstOrThrow()).consumedAt).toBeNull();
  });

  // ── Codes and links: races, with both sides provably in flight ───────────

  it("the SAME link submitted twice at once: exactly one request succeeds, one password is set", async () => {
    await prisma.user.update({ where: { id: "u1" }, data: { status: "invited" } });
    await prisma.authToken.create({ data: tokenRow("u1", "tok-twice", "reset", "a@example.com") });
    let applied = 0;
    const submit = (hash: string) => spendAuthToken({
      db: prisma, token: "tok-twice", purpose: "reset",
      onProven: async (tx, user) => { applied += 1; await tx.user.update({ where: { id: user.id }, data: { passwordHash: hash, status: "active" } }); },
    });

    const holder = await hold(async (tx) => { await tx.$queryRaw`SELECT id FROM User WHERE id = ${"u1"} FOR UPDATE`; });
    const first = submit("hash-1");
    const second = submit("hash-2");
    await waitForLockWaits(2); // both have looked the link up and wait on the account row
    await holder.release();
    const results = await Promise.all([first, second]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "expired" }]);
    expect(applied).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: "u1" } });
    expect(["hash-1", "hash-2"]).toContain(user.passwordHash);
  });

  it("the same CODE submitted twice at once: exactly one sign-in succeeds", async () => {
    await prisma.otpChallenge.create({ data: codeRow("u1", "777777", "a@example.com") });
    let proven = 0;
    const submit = () => consumeLoginCode({ db: prisma, userId: "u1", code: "777777", purpose: "login", maxAttempts: 5, onProven: async () => { proven += 1; } });

    const holder = await hold(async (tx) => { await tx.$queryRaw`SELECT id FROM User WHERE id = ${"u1"} FOR UPDATE`; });
    const first = submit();
    const second = submit();
    await waitForLockWaits(2);
    await holder.release();
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(proven).toBe(1);
  });

  it("an email change that commits FIRST stops a link already looked up — no password is set (staff change, which also spends links)", async () => {
    await prisma.user.update({ where: { id: "u1" }, data: { status: "invited" } });
    await prisma.authToken.create({ data: tokenRow("u1", "tok-old", "reset", "a@example.com") });
    let applied = false;

    const change = await hold(async (tx) => {
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${"u1"} FOR UPDATE`;
      await tx.user.update({ where: { id: "u1" }, data: { email: "b@example.com" } });
      await forgetAddressProof(tx, "u1");
    });
    const spend = spendAuthToken({ db: prisma, token: "tok-old", purpose: "reset", onProven: async (tx, user) => { applied = true; await tx.user.update({ where: { id: user.id }, data: { passwordHash: "stolen", status: "active" } }); } });
    await waitForLockWaits(1); // the link has been looked up; the spend waits on the account row
    await change.release();

    expect((await spend).ok).toBe(false);
    expect(applied).toBe(false);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: "u1" } });
    expect(user.email).toBe("b@example.com");
    expect(user.passwordHash).toBeNull();
    expect(user.status).toBe("invited");
    expect(user.verifiedEmail).toBeNull();
  });

  it("an email change that commits FIRST stops a link already looked up — even a bare change that spends nothing (the address check alone)", async () => {
    await prisma.user.update({ where: { id: "u1" }, data: { status: "invited" } });
    await prisma.authToken.create({ data: tokenRow("u1", "tok-bare", "reset", "a@example.com") });
    let applied = false;

    const change = await hold(async (tx) => {
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${"u1"} FOR UPDATE`;
      await tx.user.update({ where: { id: "u1" }, data: { email: "b@example.com" } });
    });
    const spend = spendAuthToken({ db: prisma, token: "tok-bare", purpose: "reset", onProven: async () => { applied = true; } });
    await waitForLockWaits(1);
    await change.release();

    expect(await spend).toEqual({ ok: false, reason: "address_changed" });
    expect(applied).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: "u1" } })).passwordHash).toBeNull();
  });

  it("T7e: a code spent while the email is being changed — the proof never outlives the address it was for", async () => {
    await prisma.otpChallenge.create({ data: codeRow("u1", "333333", "a@example.com") });
    const change = await hold(async (tx) => {
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${"u1"} FOR UPDATE`;
      await tx.user.update({ where: { id: "u1" }, data: { email: "b@example.com" } });
      await forgetAddressProof(tx, "u1");
    });
    const consume = consumeLoginCode({ db: prisma, userId: "u1", code: "333333", purpose: "login", maxAttempts: 5 });
    await waitForLockWaits(1);
    await change.release();
    const result = await consume;
    expect(result.ok).toBe(false);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: "u1" } });
    expect(user.email).toBe("b@example.com");
    expect(user.verifiedEmail).toBeNull();
  });

  // ── Linking: one unit of work ────────────────────────────────────────────

  it("a failure creating the participant row (password sign-in or /me) leaves the seat UNCLAIMED, and the next attempt links it", async () => {
    await prisma.user.update({ where: { id: "u1" }, data: { verifiedEmail: "a@example.com" } });
    await ddl(`CREATE TRIGGER ${FAIL_PARTICIPANT} BEFORE INSERT ON SeriesParticipant FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'participant insert refused (test)'`);
    const error = quiet();
    expect(await linkSeatsForUser(prisma, "u1")).toEqual({ linked: 0, approved: false, skipped: "failed" });
    error.mockRestore();
    expect((await prisma.competitor.findUniqueOrThrow({ where: { id: "c1" } })).userId).toBeNull();
    expect(await prisma.seriesParticipant.count()).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: "u1" } })).approvalStatus).toBe("pending");

    await ddl(`DROP TRIGGER ${FAIL_PARTICIPANT}`);
    expect(await linkSeatsForUser(prisma, "u1")).toEqual({ linked: 1, approved: true, skipped: null });
    expect((await prisma.competitor.findUniqueOrThrow({ where: { id: "c1" } })).userId).toBe("u1");
    expect(await prisma.seriesParticipant.count({ where: { userId: "u1" } })).toBe(1);
  });

  it("the same failure during a code sign-in keeps the proof, undoes the whole claim, and the next visit links it", async () => {
    await prisma.otpChallenge.create({ data: codeRow("u1", "888888", "a@example.com") });
    await ddl(`CREATE TRIGGER ${FAIL_PARTICIPANT} BEFORE INSERT ON SeriesParticipant FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'participant insert refused (test)'`);
    const error = quiet();
    const { proof: result, link } = await signInWithCode("u1", "888888");
    error.mockRestore();
    expect(result).toMatchObject({ ok: true, verifiedEmail: "a@example.com" });
    expect(link).toEqual({ linked: 0, approved: false, skipped: "failed" });
    let user = await prisma.user.findUniqueOrThrow({ where: { id: "u1" } });
    expect(user.verifiedEmail).toBe("a@example.com"); // the proof stands
    expect(user.approvalStatus).toBe("pending"); // …the claim and its approval do not
    expect((await prisma.competitor.findUniqueOrThrow({ where: { id: "c1" } })).userId).toBeNull();

    await ddl(`DROP TRIGGER ${FAIL_PARTICIPANT}`);
    expect(await linkSeatsForUser(prisma, "u1")).toMatchObject({ linked: 1, approved: true });
    user = await prisma.user.findUniqueOrThrow({ where: { id: "u1" } });
    expect(user.approvalStatus).toBe("approved");
  });

  // ── Linking: both partners' FIRST sign-in at the same moment ─────────────

  async function secondPartner() {
    await prisma.user.create({ data: { id: "u2", email: "mona@example.com", name: "Mona", role: "competitor", status: "active", approvalStatus: "pending" } });
  }

  async function expectPairLinked() {
    expect((await prisma.competitor.findUniqueOrThrow({ where: { id: "c1" } })).userId).toBe("u1");
    expect((await prisma.competitor.findUniqueOrThrow({ where: { id: "c2" } })).userId).toBe("u2");
    const sara = await prisma.seriesParticipant.findUniqueOrThrow({ where: { seriesId_userId: { seriesId: "s1", userId: "u1" } } });
    const mona = await prisma.seriesParticipant.findUniqueOrThrow({ where: { seriesId_userId: { seriesId: "s1", userId: "u2" } } });
    expect(sara.partnerUserId).toBe("u2");
    expect(mona.partnerUserId).toBe("u1");
    expect([sara.lookingForPartner, mona.lookingForPartner]).toEqual([false, false]);
    expect([sara.teamName, mona.teamName]).toEqual(["FALCONS", "FALCONS"]);
  }

  it("both partners' first link at the same moment (password sign-in / /me): each ends up pointing at the other", async () => {
    await secondPartner();
    await prisma.user.updateMany({ data: { verifiedEmail: null } });
    await prisma.user.update({ where: { id: "u1" }, data: { verifiedEmail: "a@example.com" } });
    await prisma.user.update({ where: { id: "u2" }, data: { verifiedEmail: "mona@example.com" } });

    const holder = await hold(async (tx) => { await tx.$queryRaw`SELECT id FROM Series WHERE id = ${"s1"} FOR UPDATE`; });
    const sara = linkSeatsForUser(prisma, "u1");
    const mona = linkSeatsForUser(prisma, "u2");
    await waitForLockWaits(2); // both are inside their claim, queued on the competition
    await holder.release();
    expect((await Promise.all([sara, mona])).map((outcome) => outcome.linked)).toEqual([1, 1]);
    await expectPairLinked();
  });

  it("both partners' first CODE sign-in at the same moment: each ends up pointing at the other", async () => {
    await secondPartner();
    await prisma.otpChallenge.create({ data: codeRow("u1", "121212", "a@example.com") });
    await prisma.otpChallenge.create({ data: codeRow("u2", "343434", "mona@example.com") });

    // The proofs do not touch the competition row; both links then queue on it.
    const holder = await hold(async (tx) => { await tx.$queryRaw`SELECT id FROM Series WHERE id = ${"s1"} FOR UPDATE`; });
    const sara = signInWithCode("u1", "121212");
    const mona = signInWithCode("u2", "343434");
    await waitForLockWaits(2);
    await holder.release();
    const both = await Promise.all([sara, mona]);
    expect(both.every(({ proof }) => proof.ok)).toBe(true);
    expect(both.map(({ link }) => link?.linked)).toEqual([1, 1]);
    await expectPairLinked();
  });

  // ── Linking: what an ordinary sign-in does (nothing) ─────────────────────

  it("T8a: after the first claim, later sign-ins — one by one or simultaneous — change none of the athlete's choices", async () => {
    await prisma.otpChallenge.create({ data: codeRow("u1", "555555", "a@example.com") });
    const first = await signInWithCode("u1", "555555");
    expect(first).toMatchObject({ proof: { ok: true }, link: { linked: 1 } });
    const participant = await prisma.seriesParticipant.findUniqueOrThrow({ where: { seriesId_userId: { seriesId: "s1", userId: "u1" } } });
    expect(participant.lookingForPartner).toBe(false);
    expect(participant.partnerName).toBe("Mona");
    await prisma.seriesParticipant.update({ where: { id: participant.id }, data: { lookingForPartner: true, teamName: "CHOSEN BY ATHLETE" } });

    // Not a race test (that is above): repeated calls with nothing to claim.
    expect((await linkSeatsForUser(prisma, "u1")).linked).toBe(0);
    const outcomes = await Promise.all([linkSeatsForUser(prisma, "u1"), linkSeatsForUser(prisma, "u1")]);
    expect(outcomes.map((o) => o.linked)).toEqual([0, 0]);
    const again = await prisma.seriesParticipant.findUniqueOrThrow({ where: { id: participant.id } });
    expect(again.lookingForPartner).toBe(true);
    expect(again.teamName).toBe("CHOSEN BY ATHLETE");
  });

  // ── Linking: whose seat, and what it approves ────────────────────────────

  it("the payer's email on BOTH seats of their team claims the registrant's seat only", async () => {
    await prisma.competitor.update({ where: { id: "c2" }, data: { email: "a@example.com" } });
    await prisma.user.update({ where: { id: "u1" }, data: { verifiedEmail: "a@example.com" } });
    expect(await linkSeatsForUser(prisma, "u1")).toMatchObject({ linked: 1 });
    expect((await prisma.competitor.findMany({ where: { userId: "u1" } })).map((seat) => seat.id)).toEqual(["c1"]);
  });

  it("an email on seats of two teams in one competition is never claimed", async () => {
    await prisma.team.create({ data: {
      id: "t-other", seriesId: "s1", number: 9, name: "HAWKS", category: "Womens", division: "Open", paymentStatus: "paid",
      competitors: { create: [{ id: "c-other", position: 2, fullName: "Sara again", normalizedName: "sara again", email: "a@example.com" }] },
    } });
    await prisma.user.update({ where: { id: "u1" }, data: { verifiedEmail: "a@example.com" } });
    expect(await linkSeatsForUser(prisma, "u1")).toMatchObject({ linked: 0 });
    expect((await prisma.competitor.findMany({ where: { userId: "u1" } })).length).toBe(0);
  });

  it.each([
    ["unpaid", { paymentStatus: "pending" as const }, "s1"],
    ["on the waiting list", { paymentStatus: "paid" as const, waitlistedAt: new Date() }, "s1"],
    ["a training run", { paymentStatus: "paid" as const }, "s-train"],
  ])("a signed-up athlete whose seat is %s: the seat links on proof, the account stays waiting", async (_label, facts, seriesId) => {
    await prisma.team.update({ where: { id: "t1" }, data: { ...facts, seriesId } });
    await prisma.otpChallenge.create({ data: codeRow("u1", "909090", "a@example.com") });
    const { proof, link } = await signInWithCode("u1", "909090");
    expect(proof).toMatchObject({ ok: true });
    expect(link).toEqual({ linked: 1, approved: false, skipped: null });
    expect((await prisma.competitor.findUniqueOrThrow({ where: { id: "c1" } })).userId).toBe("u1");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: "u1" } })).approvalStatus).toBe("pending");
  });
});
