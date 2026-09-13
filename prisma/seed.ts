/**
 * THE FOUNDATION: the things that exist before any competition does.
 *
 * Four studios, the bootstrap BFT MENA account, a studio account for each
 * studio, and the prescribed load standards. Nothing here belongs to a
 * particular competition — `npm run db:scenarios` builds those.
 *
 * Safe to re-run: everything keys off a stable name and is upserted.
 */

import path from "node:path";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import bcrypt from "bcryptjs";

import { PrismaClient } from "../src/generated/prisma/client.ts";

import type { Division } from "../src/generated/prisma/enums.ts";

process.loadEnvFile?.(path.join(process.cwd(), ".env"));

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) });

// BFT MENA's registration form is the authority on these two words:
// CATEGORY is who is competing, DIVISION is the level they compete at.
const STUDIO_NAMES = ["West Walk", "Gharrafa", "The Pearl", "Corniche"];

const LOAD_STANDARDS: {
  division: Division;
  sex: "m" | "f";
  trapBar: string;
  bench: string;
  kettlebell: string;
  dumbbell: string;
  wallBall: string;
}[] = [
  { division: "Rookie", sex: "f", trapBar: "44 kg", bench: "20 kg", kettlebell: "8 kg", dumbbell: "4 / 5 kg", wallBall: "4 kg" },
  { division: "Open", sex: "f", trapBar: "64 kg", bench: "25 kg", kettlebell: "10 kg", dumbbell: "7.5 / 8 kg", wallBall: "4 kg" },
  { division: "Pro", sex: "f", trapBar: "84 kg", bench: "35 kg", kettlebell: "16 kg", dumbbell: "12.5 kg", wallBall: "6 kg" },
  { division: "Rookie", sex: "m", trapBar: "64 kg", bench: "40 kg", kettlebell: "12 kg", dumbbell: "7.5 / 8 kg", wallBall: "6 kg" },
  { division: "Open", sex: "m", trapBar: "84 kg", bench: "55 kg", kettlebell: "18 kg", dumbbell: "12.5 kg", wallBall: "6 kg" },
  { division: "Pro", sex: "m", trapBar: "104 kg", bench: "75 kg", kettlebell: "24 kg", dumbbell: "17.5 kg", wallBall: "9 kg" },
];

async function main() {
  // ── Studios ───────────────────────────────────────────────────────────────
  const studios = new Map<string, string>();
  for (const name of STUDIO_NAMES) {
    const studio = await prisma.studio.upsert({
      where: { name },
      create: { name },
      update: {},
    });
    studios.set(name, studio.id);
  }

  // ── The bootstrap BFT MENA account ────────────────────────────────────────
  const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || "admin@bftmena.com").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminPassword) {
    console.warn(
      "[seed] SEED_ADMIN_PASSWORD is not set — the admin account is created as `invited`.\n" +
        "       Use Forgot password on the sign-in screen to set its first password."
    );
  }

  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      name: "BFT MENA",
      role: "admin",
      status: adminPassword ? "active" : "invited",
      passwordHash: adminPassword ? await bcrypt.hash(adminPassword, 12) : null,
      emailVerified: adminPassword ? new Date() : null,
    },
    update: { role: "admin" },
  });

  // A studio account per studio, invited rather than active: each one sets its
  // own password from the invitation link, exactly as in production.
  for (const [name, studioId] of studios) {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, "")}@bftmena.com`;
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: `${name} studio`,
        role: "studio",
        status: "invited",
        studioId,
      },
      update: { role: "studio", studioId },
    });
  }

  // ── Load standards ────────────────────────────────────────────────────────
  for (const standard of LOAD_STANDARDS) {
    await prisma.loadStandard.upsert({
      where: { division_sex: { division: standard.division, sex: standard.sex } },
      create: standard,
      update: standard,
    });
  }

  console.info("[seed] foundation ready: studios, accounts, load standards.");
  console.info(`[seed] BFT MENA admin: ${adminEmail}`);
  console.info("[seed] Build the competitions with: npm run db:scenarios");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
