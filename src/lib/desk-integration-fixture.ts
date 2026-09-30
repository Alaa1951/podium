import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/access";
import type { CheckInTeam } from "@/lib/checkin";
import { resolveEffectivePermissions } from "@/lib/permissions/resolve";
import { systemRole, type AccountType } from "@/lib/permissions/system-roles";

// ─────────────────────────────────────────────────────────────────────────────
// The world the desk integration tests stand in (desk-*.integration.test.ts):
// a throwaway schema built from the project's migrations, one small
// competition, and the people of the day holding the SHIPPED roles, resolved
// the way a real account's are. Local databases only.
//
//   FALCONS (t1, gym A)  Sara and Mona, two women, both signed in —
//                        Womens · Open, wave 1 (not started), station 3.
//   The competition is ten days away, its team-change cutoff the default 24 hours.
//   HAWKS   (t2, gym B)  Lina (f) and Omar (m) — Mixed · Open, no wave.
// ─────────────────────────────────────────────────────────────────────────────

export type Actor = Pick<CurrentUser, "id" | "role" | "studioId" | "permissions">;

function account(id: string, accountType: AccountType, roles: string[], studioId: string | null = null): Actor {
  return {
    id, role: accountType, studioId,
    permissions: resolveEffectivePermissions({ accountType, approved: true, roles: roles.map((key) => systemRole(key)!), overrides: null }),
  };
}

export const actors = {
  sara: account("u-sara", "competitor", ["athlete"]),
  lina: account("u-lina", "competitor", ["athlete"]),
  organiser: account("u-org", "organiser", ["organiser"]),
  volunteer: account("u-vol", "organiser", ["volunteer"]),
  judge: account("u-judge", "organiser", ["judge"]),
  gymA: account("u-gym-a", "studio", ["gym-studio"], "studio-a"),
  gymB: account("u-gym-b", "studio", ["gym-studio"], "studio-b"),
  partial: account("u-desk", "staff", ["bft-partial"]),
};

/** A fresh schema with every migration applied, and the way to drop it again. */
export async function createSchema(prefix: string): Promise<{ prisma: PrismaClient; drop: () => Promise<void> }> {
  const base = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  if (!base || !["localhost", "127.0.0.1", "::1"].includes(base.hostname)) throw new Error("LOCAL_DATABASE_ONLY");
  const schema = `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const admin = new PrismaClient({ adapter: new PrismaMariaDb(base.toString()) });
  await admin.$executeRawUnsafe(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const schemaUrl = new URL(base.toString());
  schemaUrl.pathname = `/${schema}`;
  const migrate = spawnSync("npx prisma migrate deploy", { shell: true, encoding: "utf8", env: { ...process.env, DATABASE_URL: schemaUrl.toString() } });
  if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(schemaUrl.toString()) });
  return {
    prisma,
    drop: async () => {
      await prisma.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${schema}\``);
      await admin.$disconnect();
    },
  };
}

/** Empty the schema and put the two teams back as described above. */
export async function seed(prisma: PrismaClient): Promise<void> {
  await prisma.adminAuditLog.deleteMany();
  await prisma.membershipOperation.deleteMany();
  await prisma.score.deleteMany();
  await prisma.competitor.deleteMany();
  await prisma.team.deleteMany();
  await prisma.wave.deleteMany();
  await prisma.seriesParticipant.deleteMany();
  await prisma.athleteProfile.deleteMany();
  await prisma.series.deleteMany();
  await prisma.user.deleteMany();
  await prisma.studio.deleteMany();
  await prisma.studio.createMany({ data: [{ id: "studio-a", name: "Studio A" }, { id: "studio-b", name: "Studio B" }] });
  await prisma.series.create({ data: { id: "s1", name: "Series", slug: "series", competitionDate: new Date(Date.now() + 10 * 86_400_000), status: "scheduled" } });
  await prisma.wave.create({ data: { id: "w1", seriesId: "s1", number: 1, status: "pending" } });
  const people = [
    ["u-sara", "competitor", "f"], ["u-mona", "competitor", "f"], ["u-lina", "competitor", "f"], ["u-omar", "competitor", "m"],
    ["u-org", "organiser", null], ["u-vol", "organiser", null], ["u-judge", "organiser", null], ["u-gym-a", "studio", null], ["u-gym-b", "studio", null], ["u-desk", "staff", null],
  ] as const;
  for (const [id, role, sex] of people) {
    await prisma.user.create({
      data: {
        id, email: `${id}@example.com`, name: id.slice(2), role, status: "active", approvalStatus: "approved", verifiedEmail: `${id}@example.com`,
        ...(sex ? { athleteProfile: { create: { sex } } } : {}),
      },
    });
  }
  const seat = (id: string, position: number, fullName: string, userId: string) => ({ id, position, fullName, normalizedName: fullName.toLowerCase(), email: `${userId}@example.com`, userId });
  await prisma.team.create({
    data: {
      id: "t1", seriesId: "s1", number: 7, name: "FALCONS", category: "Womens", division: "Open", amountMinor: 25000, studioId: "studio-a", waveId: "w1", wave: 1, station: 3,
      ownership: "registrant", registrantEmail: "u-sara@example.com", registrantUserId: "u-sara",
      competitors: { create: [seat("seat-mona", 1, "Mona Saleh", "u-mona"), seat("seat-sara", 2, "Sara Ali", "u-sara")] },
    },
  });
  await prisma.team.create({
    data: {
      id: "t2", seriesId: "s1", number: 8, name: "HAWKS", category: "Mixed", division: "Open", studioId: "studio-b",
      competitors: { create: [seat("seat-lina", 1, "Lina Omar", "u-lina"), seat("seat-omar", 2, "Omar Aziz", "u-omar")] },
    },
  });
  for (const [userId, category] of [["u-sara", "Womens"], ["u-mona", "Womens"], ["u-lina", "Mixed"], ["u-omar", "Mixed"]] as const) {
    await prisma.seriesParticipant.create({ data: { seriesId: "s1", userId, category, division: "Open", lookingForPartner: false } });
  }
}

export const teamRow = (prisma: PrismaClient, id = "t1") =>
  prisma.team.findUniqueOrThrow({ where: { id }, include: { competitors: { orderBy: { position: "asc" } } } });

export const audits = (prisma: PrismaClient, action: string) => prisma.adminAuditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } });

/** The field as the entrance screen reads it, straight from the rows. */
export async function field(prisma: PrismaClient): Promise<CheckInTeam[]> {
  const teams = await prisma.team.findMany({ where: { seriesId: "s1", archivedAt: null }, orderBy: { number: "asc" }, include: { competitors: { orderBy: { position: "asc" } } } });
  return teams.map((team) => ({
    id: team.id, number: team.number, name: team.name, category: team.category, division: team.division, studio: null,
    waveId: team.waveId, waveNumber: null, station: team.station, competing: true, ready: team.warmupReadyAt !== null,
    athletes: team.competitors.map((one) => ({ id: one.id, fullName: one.fullName, arrived: one.attendedAt !== null })),
  }));
}
