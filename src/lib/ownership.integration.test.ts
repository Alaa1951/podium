/**
 * WHO REGISTERED A TEAM, AGAINST A REAL DATABASE.
 *
 * Runs the ownership backfill script itself (dry run, --apply, a second
 * --apply, --revert) against a throwaway schema built from the project's own
 * migrations, and checks the first claim of a seat records the registrant's
 * account on the team.
 *
 * Skipped unless INTEGRATION_DB=1, and refuses anything but localhost:
 *
 *   INTEGRATION_DB=1 npx vitest run src/lib/ownership.integration.test.ts
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const enabled = vi.hoisted(() => {
  const on = process.env.INTEGRATION_DB === "1";
  if (on) {
    try { process.loadEnvFile(".env"); } catch { /* DATABASE_URL must already be set */ }
  }
  process.env.NEXTAUTH_SECRET ||= "integration-test-secret";
  return on;
});

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { linkSeatsForUser } from "@/lib/link-seats";

const base = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const schema = "pudem_own_" + randomUUID().replaceAll("-", "").slice(0, 12);
const script = path.resolve("scripts/backfill-ownership.mjs");
let schemaUrl: URL;
let prisma: PrismaClient;
let admin: PrismaClient;
let workdir: string;

/** Run the backfill against the throwaway schema — and only it. */
function backfill(...args: string[]) {
  const run = spawnSync(process.execPath, [script, ...args], {
    cwd: workdir, // no .env here, and the journal lands here
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: schemaUrl.toString(),
      // Explicit MYSQL_* settings win over DATABASE_URL field by field
      // (db-credentials.mjs): pin the database too, or the local .env's
      // would be used.
      MYSQL_DATABASE: schema,
    },
  });
  if (run.status !== 0) throw new Error(run.stderr || run.stdout);
  return run.stdout;
}

const seat = (position: number, email: string | null, userId: string | null = null) => ({
  position, fullName: `P${position}`, normalizedName: `p${position}`, email, userId,
});

describe.skipIf(!enabled)("team ownership on a real database", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    if (!base || !["localhost", "127.0.0.1", "::1"].includes(base.hostname)) throw new Error("LOCAL_DATABASE_ONLY");
    admin = new PrismaClient({ adapter: new PrismaMariaDb(base.toString()) });
    await admin.$executeRawUnsafe(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    schemaUrl = new URL(base.toString());
    schemaUrl.pathname = `/${schema}`;
    const migrate = spawnSync("npx prisma migrate deploy", { shell: true, encoding: "utf8", env: { ...process.env, DATABASE_URL: schemaUrl.toString() } });
    if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(schemaUrl.toString()) });
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "podium-ownership-"));
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${schema}\``);
      await admin.$disconnect();
    }
    if (workdir) fs.rmSync(workdir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.competitor.deleteMany();
    await prisma.team.deleteMany();
    await prisma.seriesParticipant.deleteMany();
    await prisma.series.deleteMany();
    await prisma.user.deleteMany();
    for (const file of fs.readdirSync(workdir)) fs.rmSync(path.join(workdir, file));
    await prisma.series.create({ data: { id: "s1", name: "Series", slug: "series", competitionDate: new Date("2026-10-02"), status: "scheduled" } });
    await prisma.user.create({ data: { id: "u-sara", email: "sara@example.com", role: "competitor", status: "active", approvalStatus: "approved" } });
  });

  async function team(id: string, number: number, data: object, seats: ReturnType<typeof seat>[]) {
    await prisma.team.create({ data: { id, seriesId: "s1", number, name: id.toUpperCase(), category: "Womens", division: "Open", ...data, competitors: { create: seats } } });
  }
  const owner = async (id: string) => prisma.team.findUniqueOrThrow({ where: { id }, select: { ownership: true, registrantEmail: true, registrantUserId: true } });

  it("the backfill names the CRM payer wherever they sit, leaves the rest unknown, never overwrites, and runs twice harmlessly", async () => {
    // The payer (Sara) in SEAT 2, already linked to her account.
    await team("paid-by-2", 1, { source: "ghl", externalId: "c1", rawPayload: { email: " Sara@Example.com " } }, [seat(1, "mona@example.com"), seat(2, "sara@example.com", "u-sara")]);
    await team("payer-elsewhere", 2, { source: "ghl", externalId: "c2", rawPayload: { email: "payer@example.com" } }, [seat(1, "a@example.com"), seat(2, "b@example.com")]);
    await team("by-hand", 3, { source: "manual" }, [seat(1, "c@example.com"), seat(2, "d@example.com")]);
    await team("decided", 4, { source: "ghl", externalId: "c4", rawPayload: { email: "e@example.com" }, ownership: "joint" }, [seat(1, "e@example.com"), seat(2, "f@example.com")]);

    const dry = backfill();
    expect(dry).toContain("to set as registrant: 1");
    expect(dry).toContain("stay unknown: 2");
    expect(dry).toContain("already decided: 1");
    expect(dry).not.toMatch(/@/); // lists team numbers and reasons, never addresses
    expect(await owner("paid-by-2")).toEqual({ ownership: "unknown", registrantEmail: null, registrantUserId: null }); // dry run wrote nothing

    const applied = backfill("--apply");
    expect(applied).toContain("written: 1");
    expect(await owner("paid-by-2")).toEqual({ ownership: "registrant", registrantEmail: "sara@example.com", registrantUserId: "u-sara" });
    expect(await owner("payer-elsewhere")).toMatchObject({ ownership: "unknown" });
    expect(await owner("by-hand")).toMatchObject({ ownership: "unknown" });
    expect(await owner("decided")).toMatchObject({ ownership: "joint", registrantEmail: null });
    expect(fs.readdirSync(workdir).filter((file) => file.endsWith(".jsonl"))).toHaveLength(1);

    expect(backfill("--apply")).toContain("written: 0");
  });

  it("--revert puts back only what is still exactly as the run left it", async () => {
    await team("one", 1, { source: "ghl", externalId: "c1", rawPayload: { email: "sara@example.com" } }, [seat(1, "sara@example.com", "u-sara"), seat(2, "mona@example.com")]);
    await team("two", 2, { source: "ghl", externalId: "c2", rawPayload: { email: "g@example.com" } }, [seat(1, "g@example.com"), seat(2, "h@example.com")]);
    backfill("--apply");
    const journal = fs.readdirSync(workdir).find((file) => file.endsWith(".jsonl"))!;

    // BFT MENA corrects team "two" after the run.
    await prisma.team.update({ where: { id: "two" }, data: { ownership: "joint", registrantEmail: null } });

    const out = backfill("--revert", journal);
    expect(out).toContain("reverted: 1");
    expect(out).toContain("changed since, left alone: 1");
    expect(await owner("one")).toEqual({ ownership: "unknown", registrantEmail: null, registrantUserId: null });
    expect(await owner("two")).toMatchObject({ ownership: "joint" });
  });

  it("the registrant's first claim records their account on the team — a partner's claim does not", async () => {
    await prisma.user.update({ where: { id: "u-sara" }, data: { verifiedEmail: "sara@example.com", approvalStatus: "pending" } });
    await prisma.user.create({ data: { id: "u-mona", email: "mona@example.com", role: "competitor", status: "active", approvalStatus: "approved", verifiedEmail: "mona@example.com" } });
    await team("t", 1, { source: "ghl", paymentStatus: "paid", ownership: "registrant", registrantEmail: "sara@example.com" }, [seat(1, "mona@example.com"), seat(2, "sara@example.com")]);

    expect(await linkSeatsForUser(prisma, "u-mona")).toMatchObject({ linked: 1 });
    expect(await owner("t")).toMatchObject({ registrantUserId: null });

    expect(await linkSeatsForUser(prisma, "u-sara")).toMatchObject({ linked: 1, approved: true });
    expect(await owner("t")).toEqual({ ownership: "registrant", registrantEmail: "sara@example.com", registrantUserId: "u-sara" });
  });
});
