/**
 * A small competition for walking the desks of the day by hand — LOCAL ONLY.
 *
 *   node scripts/desk-fixtures.mjs              three days out: athletes and gyms may still change category / level
 *   node scripts/desk-fixtures.mjs --tomorrow   two hours out: past the cutoff — their side closed, the desk's open
 *
 * Builds (or puts back to its starting state) one competition, "Desk QA
 * (local)", slug `desk-qa`, running, with three waves and eight teams chosen
 * so every case on the entrance, warm-up and category / level screens is
 * there to press:
 *
 *   #1 DESK FALCONS  Womens · Open    wave 2   the test athlete's own team
 *   #2 DESK HAWKS    Mixed  · Open    wave 2   a woman and a man: Womens and Mens are refused
 *   #3 DESK LIONS    Mens   · Rookie  wave 2   the other gym's team
 *   #4 DESK STORM    Womens · Rookie  wave 1   on the floor: closed for its athletes, open at the desk
 *   #5 DESK PRO      Mixed  · Pro     wave 3   only BFT MENA moves it out of Pro
 *   #6 DESK SOLO     Womens · Open    wave 3   one seat
 *   #7 DESK DOOR     Mixed  · Rookie  no wave  unpaid
 *   #8 DESK WAIT     on the waiting list — must NOT appear on either desk
 *
 * Teams 1, 2 and 6 belong to the gym of `test_studio@…`; the rest to a second
 * gym, so a gym account can be seen to reach only its own. The test athlete
 * (`test_athlete@…`) sits on team 1. Nobody is checked in or ready.
 *
 * Never touches another competition, and refuses any database that is not on
 * this machine. Accounts it adds use `@desk-qa.invalid` and cannot sign in.
 */
import nextEnv from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { createDefaultZones } from "../prisma/seed-helpers.ts";
import { PrismaClient } from "../src/generated/prisma/client.ts";

nextEnv.loadEnvConfig(process.cwd());
const url = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("Desk fixtures require a local database.");
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url.toString()) });

const SERIES = "desk-qa";
// The team's side of a category / level change closes at the competition's
// own cutoff (Settings → Team changes, 24 hours here); the desk's does not.
const START = new Date(Date.now() + (process.argv.includes("--tomorrow") ? 2 * 3_600_000 : 3 * 86_400_000));
const RIVAL = "desk-qa-rival";

/** A fixture athlete with an account, so their stated sex is known to the category rule. */
async function athlete(key, name, sex, studioId) {
  const id = `desk-qa-${key}`;
  const email = `${key}@desk-qa.invalid`;
  await prisma.user.upsert({
    where: { id },
    update: { studioId, archivedAt: null },
    create: { id, email, name, role: "competitor", status: "active", approvalStatus: "approved", studioId },
  });
  await prisma.athleteProfile.upsert({ where: { userId: id }, update: { sex }, create: { userId: id, sex } });
  return { userId: id, fullName: name, email };
}

const guest = (fullName) => ({ userId: null, fullName, email: null });

try {
  const gymAccount = await prisma.user.findUnique({ where: { email: "test_studio@bftmiddleeast.com" }, select: { studioId: true } });
  const testAthlete = await prisma.user.findUnique({ where: { email: "test_athlete@bftmiddleeast.com" }, select: { id: true, name: true, email: true } });
  const gym = gymAccount?.studioId ?? (await prisma.studio.upsert({ where: { id: "desk-qa-gym" }, update: {}, create: { id: "desk-qa-gym", name: "Desk QA gym" } })).id;
  await prisma.studio.upsert({ where: { id: RIVAL }, update: {}, create: { id: RIVAL, name: "Desk QA rival gym" } });

  await prisma.series.upsert({
    where: { id: SERIES },
    update: { status: "live", archivedAt: null, competitionDate: START, teamEditCloseHours: 24 },
    create: { id: SERIES, slug: SERIES, name: "Desk QA (local)", status: "live", competitionDate: START, boardOpensAt: new Date(0), venue: "Local" },
  });
  for (const studioId of [gym, RIVAL]) {
    await prisma.seriesStudio.upsert({ where: { seriesId_studioId: { seriesId: SERIES, studioId } }, update: {}, create: { seriesId: SERIES, studioId } });
  }
  await createDefaultZones(prisma, SERIES);

  // Wave 1 is on the floor; 2 and 3 have not started.
  const waves = {};
  for (const number of [1, 2, 3]) {
    const running = number === 1;
    const state = {
      status: running ? "running" : "pending",
      startedAt: running ? new Date() : null,
      endsAt: running ? new Date(Date.now() + 80 * 60_000) : null,
      startTime: `0${8 + number}:00`,
    };
    const wave = await prisma.wave.upsert({ where: { id: `${SERIES}-wave-${number}` }, update: state, create: { id: `${SERIES}-wave-${number}`, seriesId: SERIES, number, ...state } });
    waves[number] = wave.id;
  }

  if (testAthlete) {
    await prisma.athleteProfile.upsert({ where: { userId: testAthlete.id }, update: { sex: "f" }, create: { userId: testAthlete.id, sex: "f" } });
  }
  const me = testAthlete
    ? { userId: testAthlete.id, fullName: testAthlete.name ?? "Test Athlete", email: testAthlete.email }
    : await athlete("sara", "Sara Ali", "f", gym);
  const lina = await athlete("lina", "Lina Omar", "f", gym);
  const omar = await athlete("omar", "Omar Aziz", "m", gym);
  const huda = await athlete("huda", "Huda Nasser", "f", gym);

  const teams = [
    { number: 1, name: "DESK FALCONS", category: "Womens", division: "Open", studioId: gym, wave: 2, station: 1, seats: [me, guest("Mona Saleh")] },
    { number: 2, name: "DESK HAWKS", category: "Mixed", division: "Open", studioId: gym, wave: 2, station: 2, seats: [lina, omar] },
    { number: 3, name: "DESK LIONS", category: "Mens", division: "Rookie", studioId: RIVAL, wave: 2, station: 3, seats: [guest("Khalid Hamad"), guest("Yousef Karim")] },
    { number: 4, name: "DESK STORM", category: "Womens", division: "Rookie", studioId: RIVAL, wave: 1, station: 1, seats: [guest("Noor Fahad"), guest("Dana Salem")] },
    { number: 5, name: "DESK PRO", category: "Mixed", division: "Pro", studioId: RIVAL, wave: 3, station: 1, seats: [guest("Rana Tamer"), guest("Fahad Nabil")] },
    { number: 6, name: "DESK SOLO", category: "Womens", division: "Open", studioId: gym, wave: 3, station: 2, seats: [huda] },
    { number: 7, name: "DESK DOOR", category: "Mixed", division: "Rookie", studioId: RIVAL, wave: null, station: null, unpaid: true, seats: [guest("Maya Adel"), guest("Tariq Sami")] },
    { number: 8, name: "DESK WAIT", category: "Womens", division: "Rookie", studioId: RIVAL, wave: null, station: null, waiting: true, seats: [guest("Aya Zaid"), guest("Lama Hadi")] },
  ];

  // Stations are unique per wave: free them all before putting each back.
  await prisma.team.updateMany({ where: { seriesId: SERIES }, data: { station: null, waveId: null } });
  for (const team of teams) {
    const id = `${SERIES}-team-${team.number}`;
    // The starting state, every run: bracket, wave, payment — nobody arrived, nobody ready.
    const state = {
      name: team.name, category: team.category, division: team.division, studioId: team.studioId, archivedAt: null,
      waveId: team.wave ? waves[team.wave] : null, wave: team.wave ?? 1, station: team.station,
      paymentStatus: team.unpaid ? "pending" : "paid", paidAt: team.unpaid ? null : new Date(), amountMinor: team.unpaid ? null : 25000,
      waitlistedAt: team.waiting ? new Date() : null, attendedAt: null, warmupReadyAt: null,
    };
    await prisma.team.upsert({ where: { id }, update: state, create: { id, seriesId: SERIES, number: team.number, source: "seed", ...state } });
    await prisma.score.deleteMany({ where: { teamId: id } });
    await prisma.competitor.deleteMany({ where: { teamId: id, position: { gt: team.seats.length } } });
    for (const [index, seat] of team.seats.entries()) {
      const position = index + 1;
      const person = {
        fullName: seat.fullName, normalizedName: seat.fullName.toLowerCase(), email: seat.email, userId: seat.userId, studioId: team.studioId, attendedAt: null,
      };
      await prisma.competitor.upsert({ where: { teamId_position: { teamId: id, position } }, update: person, create: { id: `${id}-seat-${position}`, teamId: id, position, ...person } });
      if (seat.userId) {
        const entry = { category: team.category, division: team.division, lookingForPartner: false, teamName: team.name, archivedAt: null };
        await prisma.seriesParticipant.upsert({ where: { seriesId_userId: { seriesId: SERIES, userId: seat.userId } }, update: entry, create: { seriesId: SERIES, userId: seat.userId, ...entry } });
      }
    }
  }

  console.log(`Desk QA ready: /series/${SERIES}/check-in · /series/${SERIES}/warm-up · /studio/${SERIES}/check-in · /me?series=${SERIES}`);
  if (!testAthlete) console.log("No test_athlete account here: team 1 has a fixture athlete who cannot sign in.");
} finally {
  await prisma.$disconnect();
}
