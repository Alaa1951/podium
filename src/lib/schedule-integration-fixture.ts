import { spawnSync } from "node:child_process";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import type { Category, Division, Role } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/lib/access";
import { resolveEffectivePermissions } from "@/lib/permissions/resolve";
import { systemRole } from "@/lib/permissions/system-roles";

// ─────────────────────────────────────────────────────────────────────────────
// The competition the category-schedule integration tests stand in
// (schedule-*.integration.test.ts). The test file points DATABASE_URL at a
// throwaway schema in vi.hoisted — before the app's own Prisma client is
// imported — so the ACTIONS run for real against it; this builds the schema
// from the project's migrations and seeds it. Local databases only.
//
//   One competition, "s1", ten days out: 4 zones of 15 minutes with
//   5-minute changeovers (a 75-minute wave; Zone 1 busy 20 minutes), waves
//   20 minutes apart, 7 teams per wave.
//   Men 8 (6 Rookie, 1 Open, 1 Pro) · Mixed 5 Open · Women 3 Rookie.
//   Teams 1–8 Men, 11–15 Mixed, 21–23 Women; gym A has them all but #23 (gym B).
// ─────────────────────────────────────────────────────────────────────────────

export type Actor = CurrentUser;

function account(id: string, role: Role, roles: string[], studioId: string | null = null): Actor {
  return {
    id, email: `${id}@example.com`, name: id, role, studioId, locale: "en",
    permissions: role === "admin" ? ["*"] : resolveEffectivePermissions({ accountType: role, approved: true, roles: roles.map((key) => systemRole(key)!), overrides: null }),
  };
}

export const actors = {
  hq: account("u-hq", "admin", []),
  organiser: account("u-org", "organiser", ["organiser"]),
  volunteer: account("u-vol", "organiser", ["volunteer"]),
  judge: account("u-judge", "organiser", ["judge"]),
  gymA: account("u-gym-a", "studio", ["gym-studio"], "studio-a"),
  gymB: account("u-gym-b", "studio", ["gym-studio"], "studio-b"),
  athlete: account("u-ath", "competitor", ["athlete"]),
};

/** Create the schema named in DATABASE_URL and apply every migration to it. */
export async function createSchema(baseUrl: string, schemaUrl: string): Promise<() => Promise<void>> {
  const base = new URL(baseUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(base.hostname)) throw new Error("LOCAL_DATABASE_ONLY");
  const schema = new URL(schemaUrl).pathname.slice(1);
  const admin = new PrismaClient({ adapter: new PrismaMariaDb(base.toString()) });
  await admin.$executeRawUnsafe(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const migrate = spawnSync("npx prisma migrate deploy", { shell: true, encoding: "utf8", env: { ...process.env, DATABASE_URL: schemaUrl } });
  if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
  return async () => {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.$disconnect();
  };
}

const TEAMS: [number, Category, Division][] = [
  ...[1, 2, 3, 4, 5, 6].map((n) => [n, "Mens", "Rookie"] as [number, Category, Division]),
  [7, "Mens", "Open"], [8, "Mens", "Pro"],
  ...[11, 12, 13, 14, 15].map((n) => [n, "Mixed", "Open"] as [number, Category, Division]),
  ...[21, 22, 23].map((n) => [n, "Womens", "Rookie"] as [number, Category, Division]),
];

export async function seed(prisma: PrismaClient): Promise<void> {
  await prisma.adminAuditLog.deleteMany();
  await prisma.categorySchedule.deleteMany();
  await prisma.zoneScore.deleteMany();
  await prisma.score.deleteMany();
  await prisma.competitor.deleteMany();
  await prisma.team.deleteMany();
  await prisma.wave.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.series.deleteMany();
  await prisma.user.deleteMany();
  await prisma.studio.deleteMany();
  await prisma.studio.createMany({ data: [{ id: "studio-a", name: "Studio A" }, { id: "studio-b", name: "Studio B" }] });
  for (const actor of Object.values(actors)) {
    await prisma.user.create({ data: { id: actor.id, email: actor.email, name: actor.name, role: actor.role, status: "active", studioId: actor.studioId } });
  }
  await prisma.series.create({
    data: {
      id: "s1", name: "Series", slug: "series", status: "scheduled", competitionDate: new Date(Date.now() + 10 * 86_400_000),
      waveIntervalMinutes: 20, zoneWorkMinutes: 15, zoneBreakMinutes: 5, waveCapacity: 7, waveMinutes: 75,
      zones: { create: [1, 2, 3, 4].map((number) => ({ number, name: `Zone ${number}` })) },
    },
  });
  for (const [number, category, division] of TEAMS) {
    await prisma.team.create({
      data: {
        id: `t${number}`, seriesId: "s1", number, name: `TEAM ${number}`, category, division,
        studioId: number === 23 ? "studio-b" : "studio-a",
        competitors: { create: [1, 2].map((position) => ({ position, fullName: `Athlete ${number}-${position}`, normalizedName: `athlete ${number} ${position}` })) },
      },
    });
  }
}

/** The day that fits this field with room to spare: Men 09:00 (+60), Mixed 11:35 (+60), Women 14:00 (+90). */
export const FITTING = [
  { category: "Mens" as const, position: 1, startTime: "09:00", breakMinutes: 60 },
  { category: "Mixed" as const, position: 2, startTime: "11:35", breakMinutes: 60 },
  { category: "Womens" as const, position: 3, startTime: "14:00", breakMinutes: 90 },
];

export const team = (prisma: PrismaClient, number: number) =>
  prisma.team.findUniqueOrThrow({ where: { id: `t${number}` }, include: { waveRef: true, competitors: true } });

/** Every placement, as [team number, wave number, start, block, station, manual]. */
export async function layout(prisma: PrismaClient) {
  const teams = await prisma.team.findMany({ where: { seriesId: "s1" }, orderBy: { number: "asc" }, include: { waveRef: true } });
  return teams.map((one) => [one.number, one.waveRef?.number ?? null, one.waveRef?.startTime ?? null, one.waveRef?.blockCategory ?? null, one.station, Boolean(one.slotManualAt)]);
}
