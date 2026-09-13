/**
 * The three scenarios, side by side.
 *
 * One competition cannot show what the system looks like before, during and
 * after, so the demo data carries one of each:
 *
 *   Series 1  FINISHED   final, every score in, winners and public results
 *   Series 2  LIVE       running mid-field, two waves on the floor at once
 *   Series 3  UPCOMING   nothing registered, the countdown on every screen
 *
 * Run with `npm run db:scenarios`. It rebuilds only these three series, so it
 * is safe to re-run while iterating on the design.
 */

import path from "node:path";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "../src/generated/prisma/client.ts";
import {
  createDefaultZones,
  demoBirthday,
  demoEmail,
  demoEntries,
  demoPhone,
  entryRows,
} from "./seed-helpers.ts";
import type { Category, Division, WaveStatus } from "../src/generated/prisma/enums.ts";
import { SCENARIOS, type Scenario, type WavePlan } from "./seed-plans.ts";

process.loadEnvFile?.(path.join(process.cwd(), ".env"));

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) });

// BFT MENA's registration form is the authority on these two words:
// CATEGORY is who is competing, DIVISION is the level they compete at.
const CATEGORIES: Category[] = ["Womens", "Mens", "Mixed"];
const DIVISIONS: Division[] = ["Rookie", "Open", "Pro"];

const W1 = ["IRON", "STEEL", "APEX", "NORTH", "RAW", "BLACK", "HAVOC", "GRIT", "TORQUE", "VOLT", "RIOT", "ANVIL"];
const W2 = ["CLAUSE", "FORGE", "LINE", "UNIT", "CREW", "WORKS", "ORDER", "HOUSE", "GUILD"];
const MALE = ["Omar", "Youssef", "Karim", "Hassan", "Tariq", "Faisal", "Adel", "Sami", "Rashid", "Bilal", "Jamal", "Nabil", "Ziad"];
const FEMALE = ["Sara", "Layla", "Nour", "Mariam", "Dana", "Reem", "Hind", "Lina", "Aisha", "Salma", "Rania", "Yasmin", "Amal"];
const LAST = ["Haddad", "Nasser", "Khalil", "Fahmy", "Zaid", "Mansour", "Aziz", "Darwish", "Rahman", "Sultan", "Barakat", "Yousef"];

/** Deterministic, so every re-seed produces the same field and the same podium. */
const rnd = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const normalizeName = (value: string) =>
  value.toLowerCase().normalize("NFKD").replace(/[^\p{Letter} ]/gu, "").replace(/\s+/g, " ").trim();

const DAY = 86_400_000;

async function studioIds() {
  const studios = await prisma.studio.findMany({ select: { id: true, name: true } });
  if (studios.length === 0) {
    throw new Error("No studios — run `npm run db:seed` first.");
  }
  return studios;
}

/** Where a given wave number stands in this scenario's running order. */
function waveStatusOf(plan: WavePlan, number: number): WaveStatus {
  if (plan.running.includes(number)) return "running";
  return number <= plan.complete ? "complete" : "pending";
}

/**
 * Demo sponsor artwork: small inline SVG wordmarks, so the sponsor rail shows
 * real images in the scenarios without shipping anyone's actual trademark.
 */
const DEMO_SPONSORS = [
  { alt: "Fitline", color: "#c9a227" },
  { alt: "Hydra+", color: "#00b5cc" },
  { alt: "GripCo", color: "#f2f2f3" },
];

function demoSponsorLogo(name: string, color: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="112">` +
    `<text x="170" y="72" font-family="Arial, Helvetica, sans-serif" font-size="42" ` +
    `font-weight="bold" fill="${color}" text-anchor="middle" letter-spacing="6">${name}</text></svg>`;
  return Buffer.from(svg).toString("base64");
}

async function buildScenario(scenario: Scenario, studios: { id: string; name: string }[]) {
  const now = Date.now();
  const plan = scenario.waves;

  // Rebuilt from scratch so re-running is idempotent — and so a change to the
  // scenario is visible immediately rather than merged into yesterday's.
  const existing = await prisma.series.findFirst({ where: { slug: scenario.slug } });
  if (existing) await prisma.series.delete({ where: { id: existing.id } });

  const competitionDate = scenario.on ?? new Date(now + scenario.offsetDays * DAY);

  const series = await prisma.series.create({
    data: {
      name: scenario.name,
      slug: scenario.slug,
      competitionDate,
      venue: "All studios",
      status: scenario.status,
      firstWaveTime: "09:00",
      waveMinutes: plan.minutes,
      waveCapacity: plan.capacity,
      // The board unlocks when the competition starts — which for the upcoming
      // one is exactly what every screen is counting down to.
      boardOpensAt: competitionDate,
      // The BFT manual: a saved score is final. Studios do not score here
      // unless it is deliberately opened for them, and the live competition is
      // the one where it is.
      studiosMayEnterScores: scenario.status === "live",
      studioScoreCorrections: 0,
      registrationClosesAt: new Date(competitionDate.getTime() - 3 * DAY),
      // The manual's own seven key dates: a studio's entries are final a week
      // out, and the international placings land two weeks after ours.
      registrationsFinalAt: new Date(competitionDate.getTime() - 7 * DAY),
      scoreEntryClosesAt: new Date(competitionDate.getTime() + 2 * DAY),
      resultsPublicAt: scenario.resultsPublic
        ? new Date(competitionDate.getTime() + 2 * DAY)
        : null,
      championsAnnouncedAt: new Date(competitionDate.getTime() + 16 * DAY),
      showTeamName: true,
      showCompetitorNames: true,
      showStudioColumn: true,
      sponsorsEnabled: true,
      // Every studio in the directory takes part in the demo competitions.
      studios: { create: studios.map((studio) => ({ studioId: studio.id })) },
    },
  });

  // Each competition carries its own zones. All three start from the Series 1
  // table; editing one does not touch the others, which is the point.
  const inputIds = await createDefaultZones(prisma, series.id);

  // The sponsor rail: three demo marks, so the strip is exercised everywhere
  // it renders. The remaining slots stay placeholders, the way an event that
  // has not signed all its partners looks.
  await prisma.sponsor.createMany({
    data: DEMO_SPONSORS.map((sponsor, index) => ({
      seriesId: series.id,
      alt: sponsor.alt,
      position: index,
      imageB64: demoSponsorLogo(sponsor.alt.toUpperCase(), sponsor.color),
      mimeType: "image/svg+xml",
    })),
  });

  // ── The running order ─────────────────────────────────────────────────────
  // Each wave carries its own start, length and capacity. Wave 10 is fifteen
  // minutes rather than twenty, so the screens have to read the wave's own
  // figure and cannot fall back on one number for the day.
  const waveIds = new Map<number, string>();
  let clock = 9 * 60; // 09:00, in minutes past midnight

  for (let number = 1; number <= plan.total; number++) {
    const durationMinutes = number === 10 ? 15 : plan.minutes;
    const status = waveStatusOf(plan, number);

    const wave = await prisma.wave.create({
      data: {
        seriesId: series.id,
        number,
        startTime: `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`,
        durationMinutes,
        capacity: plan.capacity,
        status,
        startedAt: status === "pending" ? null : new Date(now - durationMinutes * 60_000),
        endsAt:
          status === "running"
            ? new Date(now + Math.round(durationMinutes * 0.55) * 60_000)
            : status === "complete"
              ? new Date(now - 60_000)
              : null,
      },
    });

    waveIds.set(number, wave.id);
    clock += durationMinutes;
  }

  if (scenario.teamsPerBracket === null) {
    console.info(`[scenario] ${scenario.name} — upcoming ${competitionDate.toISOString().slice(0, 10)}, no teams (countdown)`);
    return;
  }

  let i = 0;
  let scoredCount = 0;
  let unpaidCount = 0;

  for (const category of CATEGORIES) {
    for (const division of DIVISIONS) {
      for (let k = 0; k < scenario.teamsPerBracket; k++) {
        const seed = i + 1 + scenario.offsetDays * 7;
        // Heavier loads at the higher level, so the field spreads the way the
        // real one does. The level is the division.
        const boost = division === "Pro" ? 1.18 : division === "Open" ? 1.0 : 0.84;

        // Who is on the team is the category: two women, two men, or one each.
        const first = category === "Womens" ? FEMALE[i % 13] : MALE[i % 13];
        const second = category === "Mens" ? MALE[(i * 5 + 6) % 13] : FEMALE[(i * 5 + 6) % 13];
        const competitorNames = [
          `${first} ${LAST[i % 12]}`,
          `${second} ${LAST[(i * 7 + 4) % 12]}`,
        ];

        const wave = Math.floor(i / 9) + 1;
        const waveStatus = waveStatusOf(plan, wave);

        // A team is scored if its wave has already run, and about half-scored
        // if its wave is on the floor — which is what makes a live board look
        // mid-competition rather than randomly patchy.
        const isScored =
          scenario.scored >= 1
            ? true
            : waveStatus === "complete"
              ? rnd(seed + 900) < 0.96
              : waveStatus === "running"
                ? rnd(seed + 900) < 0.5
                : false;

        const owning = studios[Math.floor(rnd(seed + 420) * studios.length) % studios.length];
        const secondMember = rnd(seed + 240) > 0.42;

        // A few registrations on the live event whose money has not landed:
        // they are registered, they are NOT on the board, and the payments
        // screen is what gets them there.
        const unpaid = scenario.status === "live" && i % 17 === 5;

        const team = await prisma.team.create({
          data: {
            seriesId: series.id,
            number: 101 + i,
            name: `${W1[i % 12]} ${W2[(i * 5 + Math.floor(i / 12)) % 9]}`,
            category,
            division,
            wave,
            waveId: waveIds.get(wave) ?? null,
            studioId: owning.id,
            scoreEdits: isScored ? 1 : 0,
            // A registration reaches PODIUM once the money is confirmed, so
            // the demo field is paid — except a handful left pending on the
            // live event, which is what the payments screen exists to show.
            paymentStatus: unpaid ? "pending" : "paid",
            source: i % 11 === 0 ? "manual" : "ghl",
            registeredAt: new Date(now - (14 + (i % 21)) * DAY),
            paidAt: unpaid ? null : new Date(now - (13 + (i % 20)) * DAY),
            amountMinor: unpaid ? null : 25000,
            currency: "QAR",
            billingNumber: unpaid ? null : `GLF-${series.id.slice(-4)}-${101 + i}`,
            externalId: `ghl-${series.id.slice(-6)}-${101 + i}`,
            attendedAt: unpaid ? null : new Date(competitionDate.getTime()),
            competitors: {
              create: competitorNames.map((fullName, index) => ({
                fullName,
                position: index + 1,
                normalizedName: normalizeName(fullName),
                phone: demoPhone(seed + index * 17),
                email: demoEmail(fullName),
                dateOfBirth: demoBirthday(seed + index * 17),
                // Studio MEMBERSHIP, which about half of a real field has.
                studioId: index === 0 || secondMember ? owning.id : null,
              })),
            },
          },
        });

        await prisma.score.create({
          data: {
            teamId: team.id,
            status: isScored ? "submitted" : "draft",
            submittedAt: isScored ? new Date(now - rnd(seed + 500) * 3 * 3_600_000) : null,
            entries: isScored
              ? { create: entryRows(inputIds, demoEntries(seed, boost)) }
              : undefined,
          },
        });

        if (unpaid) unpaidCount++;
        if (isScored) scoredCount++;
        i++;
      }
    }
  }

  const floor = plan.running.length ? `waves ${plan.running.join(" + ")} on the floor` : "no wave running";
  console.info(
    `[scenario] ${scenario.name} — ${scenario.status}, ${i} registered ` +
      `(${i - unpaidCount} paid, ${unpaidCount} pending), ${scoredCount} scored, ${floor}`
  );
}

async function main() {
  const studios = await studioIds();
  for (const scenario of SCENARIOS) {
    await buildScenario(scenario, studios);
  }
  console.info("\n[scenario] three series ready: finished · live · upcoming");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
