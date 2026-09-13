/**
 * DEV ONLY — puts a usable studio account and a usable competitor account in
 * front of you, so all three roles can be walked without going through an
 * invitation and an inbox.
 *
 *   node scripts/dev-accounts.mjs
 *
 * It refuses to run against anything but a local database, and it never touches
 * the admin account. Everything it does is something BFT MENA can also do from
 * the People screen — it is a shortcut, not a back door.
 */
import crypto from "node:crypto";
import path from "node:path";

import bcrypt from "bcryptjs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "../src/generated/prisma/client.ts";

process.loadEnvFile?.(path.join(process.cwd(), ".env"));

/**
 * The walk's own device.
 *
 * Registering it as trusted is what stops `scripts/walk.mjs` from triggering a
 * sign-in code — which, when it happened, consumed the code a real person was
 * waiting for one second after it was issued.
 */
export const WALK_FINGERPRINT = "podium-dev-walk";

// The same fallback chain as src/lib/security.ts, so the two agree about what
// a fingerprint hashes to.
const DEVICE_SECRET =
  process.env.DEVICE_FINGERPRINT_SECRET || process.env.NEXTAUTH_SECRET || "";

const hashFingerprint = (raw) =>
  crypto.createHmac("sha256", DEVICE_SECRET).update(raw).digest("hex");

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Refusing to run: DATABASE_URL does not point at a local database.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) });
const PASSWORD = "PodiumDev!2026";
const hash = await bcrypt.hash(PASSWORD, 12);

// ── A studio that is actually in a competition ───────────────────────────────
const link = await prisma.seriesStudio.findFirst({
  where: { series: { slug: "podium-series-2" } },
  select: { studioId: true, studio: { select: { name: true } } },
});
if (!link) throw new Error("No studio is linked to podium-series-2 — run db:scenarios first.");

const studioUser = await prisma.user.findFirst({
  where: { role: "studio", studioId: link.studioId },
});
if (!studioUser) throw new Error(`No studio account for ${link.studio.name}.`);

await prisma.user.update({
  where: { id: studioUser.id },
  data: { status: "active", passwordHash: hash, emailVerified: new Date() },
});

// ── A competitor, attached to one of that studio's own pairs ─────────────────
const competitor = await prisma.competitor.findFirst({
  where: { team: { studioId: link.studioId, series: { slug: "podium-series-2" } } },
  select: { id: true, fullName: true, email: true, team: { select: { name: true } } },
});
if (!competitor) throw new Error("That studio has no teams in podium-series-2.");

const email = competitor.email ?? `${competitor.id}@example.com`;
const account = await prisma.user.upsert({
  where: { email },
  create: {
    email,
    name: competitor.fullName,
    role: "competitor",
    status: "active",
    passwordHash: hash,
    emailVerified: new Date(),
    studioId: link.studioId,
  },
  update: { status: "active", passwordHash: hash, role: "competitor" },
});

await prisma.competitor.update({
  where: { id: competitor.id },
  data: { userId: account.id },
});

// ── A throwaway admin ────────────────────────────────────────────────────────
// Deliberately NOT your own admin account: this script does not learn or reset
// the password you actually use. Delete this one from the People screen when
// you are finished with it.
const admin = await prisma.user.upsert({
  where: { email: "walk-admin@bftmena.com" },
  create: {
    email: "walk-admin@bftmena.com",
    name: "Route walk (dev)",
    role: "admin",
    status: "active",
    passwordHash: hash,
    emailVerified: new Date(),
  },
  update: { status: "active", passwordHash: hash, role: "admin" },
});

// ── Trust the walk's device for everyone it signs in as ─────────────────────
const fingerprint = hashFingerprint(WALK_FINGERPRINT);
const expires = new Date(Date.now() + 30 * 24 * 3_600_000);

for (const id of [studioUser.id, account.id, admin.id]) {
  await prisma.trustedDevice.upsert({
    where: { userId_deviceFingerprint: { userId: id, deviceFingerprint: fingerprint } },
    create: {
      userId: id,
      deviceFingerprint: fingerprint,
      deviceLabel: "PODIUM route walk",
      isTrusted: true,
      trustExpiresAt: expires,
    },
    update: { isTrusted: true, isRevoked: false, trustExpiresAt: expires },
  });
}

console.log(`
Admin       ${admin.email}   (throwaway — not your own admin account)
Studio      ${studioUser.email}      (${link.studio.name})
Competitor  ${email}   (${competitor.fullName}, team ${competitor.team.name})
Password    ${PASSWORD}

Sign in at http://localhost:3000/login — a competitor may also use the OTP door
at /competitor.
`);

process.exit(0);
