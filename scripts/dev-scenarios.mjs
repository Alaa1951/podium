/**
 * DEV ONLY — the full test-scenario cast for the PODIUM MENA build.
 *
 *   node scripts/dev-scenarios.mjs
 *
 * Creates (idempotently):
 *   ADMINS
 *     walk-admin@bftmena.com            full admin (exists from dev-accounts)
 *     limited.admin@keysintl.com        admin WITHOUT most permissions
 *                                       (RBAC test: results + board + users only)
 *   STUDIO MANAGERS  (one per studio)
 *     manager.westwalk@keysintl.com     West Walk
 *     manager.gharrafa@keysintl.com     Gharrafa
 *     manager.thepearl@keysintl.com     The Pearl
 *     manager.corniche@keysintl.com     Corniche
 *   COMPETITORS  (one per event state)
 *     competitor.finished@keysintl.com    series-1 (finished + published)
 *     competitor.running@keysintl.com     series-2 (live now)
 *     competitor.upcoming@keysintl.com    series-3 (not started yet)
 *
 * Password for every account: PodiumDev!2026
 * Emails land on the real keysintl inbox once SMTP_PASSWORD is filled.
 */
import path from "node:path";

import bcrypt from "bcryptjs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { normalizeName } from "../src/lib/scoring.ts";
import { PrismaClient } from "../src/generated/prisma/client.ts";

process.loadEnvFile?.(path.join(process.cwd(), ".env"));

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL does not point at a local database.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
const PASSWORD = "PodiumDev!2026";
const hash = await bcrypt.hash(PASSWORD, 12);

async function upsertUser(data) {
  return prisma.user.upsert({
    where: { email: data.email },
    create: { ...data, passwordHash: hash, emailVerified: new Date(), status: "active" },
    update: { ...data, passwordHash: hash, status: "active" },
  });
}

// ── 1. The limited admin (RBAC test) ────────────────────────────────────────
const LIMITED_KEY = "limited-admin";
const limitedRole = await prisma.accessRole.findUnique({ where: { key: LIMITED_KEY } });
if (!limitedRole) {
  limitedRole = await prisma.accessRole.create({
    data: {
      key: LIMITED_KEY,
      name: "Limited admin",
      nameAr: "مدير محدود الصلاحيات",
      description: "Test role: results, live board and users only.",
      permissions: ["results.view", "board.view", "users.view"],
      isSystem: false,
    },
  });
}

await upsertUser({
  email: "limited.admin@keysintl.com",
  name: "Limited admin (test)",
  role: "competitor",
  accessRoleId: limitedRole.id,
  studioId: null,
  locale: "en",
});

// ── 2. One manager per studio ───────────────────────────────────────────────
const studios = await prisma.studio.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
const managers = [];
for (const studio of studios) {
  const email = `manager.${studio.name.toLowerCase().replace(/[^a-z]/g, "")}@keysintl.com`;
  const manager = await upsertUser({
    email,
    name: `${studio.name} manager`,
    role: "studio",
    studioId: studio.id,
    locale: "en",
  });
  managers.push({ manager, studio });
}

// ── 3. One competitor per event state ───────────────────────────────────────
// series-1 = finished, series-2 = live, series-3 = scheduled (per the scenarios
// seed). Attach each to an existing paid team of that series when one exists.
const seriesRows = await prisma.series.findMany({
  orderBy: { competitionDate: "desc" },
  select: { id: true, slug: true, name: true, status: true, competitionDate: true },
});
const tag = { "podium-series-1": "finished", "podium-series-2": "running", "podium-series-3": "upcoming" };

const competitors = [];
for (const series of seriesRows) {
  const email = `competitor.${tag[series.slug] ?? series.slug}@keysintl.com`;
  const name = `Competitor (${tag[series.slug] ?? series.slug})`;
  const user = await upsertUser({
    email,
    name,
    role: "competitor",
    studioId: null,
    locale: "en",
  });

  const team = await prisma.team.findFirst({
    where: { seriesId: series.id, paymentStatus: "paid" },
    orderBy: { number: "asc" },
    select: { id: true, number: true, name: true },
  });

  if (team) {
    // Sit this account on one of the pair's competitor rows (dev-accounts
    // pattern): getMyTeam resolves through competitors.userId.
    const free = await prisma.competitor.findFirst({
      where: { teamId: team.id, userId: null },
      orderBy: { fullName: "asc" },
    });
    if (free) {
      await prisma.competitor.update({ where: { id: free.id }, data: { userId: user.id } });
    }
  } else if (series.status === "scheduled") {
    // The upcoming event has no field yet — register a lone pair so the
    // "upcoming" competitor has an entry to look at before the day.
    const maxNumber = await prisma.team.aggregate({
      where: { seriesId: series.id },
      _max: { number: true },
    });
    const created = await prisma.team.create({
      data: {
        seriesId: series.id,
        number: (maxNumber._max.number ?? 0) + 1,
        name: name.toUpperCase(),
        category: "Womens",
        division: "Rookie",
        paymentStatus: "pending",
        source: "manual",
        registeredAt: new Date(),
        competitors: {
          create: [
            {
              position: 1,
              fullName: name,
              normalizedName: normalizeName(name),
              dateOfBirth: new Date("1995-01-01"),
              userId: user.id,
            },
          ],
        },
      },
    });
    competitors.push({ series: series.slug, team: created.name, registered: true });
    continue;
  }

  competitors.push({ series: series.slug, team: team?.name ?? null });
}

console.log(`
Limited admin  limited.admin@keysintl.com   (RBAC test — results/board/users only)
${managers
  .map((m) => `Studio manager  ${m.manager.email.padEnd(34)} (${m.studio.name})`)
  .join("\n")}
${seriesRows
  .map(
    (s) =>
      `Competitor     competitor.${tag[s.slug] ?? s.slug}@keysintl.com`.padEnd(52) +
      ` (${s.name} — ${s.status})`
  )
  .join("\n")}

Password for every account: ${PASSWORD}

After filling SMTP_PASSWORD in .env and restarting, OTP codes arrive at the
real keysintl inbox. Until then they stay in dev-server.log (npm run otp).
`);

process.exit(0);
