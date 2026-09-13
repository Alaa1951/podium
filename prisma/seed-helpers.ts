/**
 * Shared demo-data helpers, so both seeds build the same shaped world.
 *
 * Everything here is deterministic: the same seed number always produces the
 * same person, the same phone, the same result. Re-seeding therefore gives you
 * the same podium, which is what makes a screenshot from yesterday still worth
 * comparing against.
 */

import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { DEFAULT_ZONES } from "../src/lib/zones.ts";

/**
 * Writes Series 1's zone definition into a series, and hands back a lookup from
 * "zone.position" (e.g. "4.2" = the finisher's seconds) to the ZoneInput id,
 * which is what a ZoneEntry points at.
 *
 * Idempotent: a series that already has zones keeps them, and only the lookup
 * is rebuilt, so re-seeding never silently replaces an edited definition.
 */
export async function createDefaultZones(prisma: PrismaClient, seriesId: string) {
  const ids = new Map<string, string>();

  const existing = await prisma.zone.findMany({
    where: { seriesId },
    include: { inputs: true },
  });

  if (existing.length > 0) {
    for (const zone of existing) {
      for (const input of zone.inputs) ids.set(`${zone.number}.${input.position}`, input.id);
    }
    return ids;
  }

  for (const definition of DEFAULT_ZONES) {
    const zone = await prisma.zone.create({
      data: {
        seriesId,
        number: definition.number,
        name: definition.name,
        inputs: { create: definition.inputs.map((input) => ({ ...input })) },
      },
      include: { inputs: true },
    });
    for (const input of zone.inputs) ids.set(`${zone.number}.${input.position}`, input.id);
  }

  return ids;
}

/** Deterministic pseudo-random, so re-seeding produces the same field. */
export const rnd = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** A plausible Gulf mobile number, derived from the name so it never changes. */
export function demoPhone(seed: number) {
  const digits = String(Math.floor(rnd(seed + 7000) * 90_000_000) + 10_000_000);
  return `+974 ${digits.slice(0, 4)} ${digits.slice(4, 8)}`;
}

/** first.last@example.com — clearly not a real address. */
export function demoEmail(fullName: string) {
  return `${fullName.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`;
}

/** A birthday between 20 and 45 years ago. */
export function demoBirthday(seed: number) {
  const age = 20 + Math.floor(rnd(seed + 8000) * 26);
  const month = Math.floor(rnd(seed + 8100) * 12);
  const day = 1 + Math.floor(rnd(seed + 8200) * 28);
  return new Date(Date.UTC(new Date().getUTCFullYear() - age, month, day));
}

/**
 * The seven Series 1 values for one team, as a "zone.position" map ready to
 * become ZoneEntry rows. `boost` spreads the field by division, the way a
 * higher level really does spread it.
 */
export function demoEntries(seed: number, boost: number): Record<string, number> {
  return {
    "1.1": Math.round((124 + rnd(seed) * 74) * boost), // deadlift reps
    "1.2": Math.round((108 + rnd(seed + 300) * 66) * boost), // bench reps
    "2.1": Math.round(((1780 + rnd(seed + 40) * 820) * boost) / 10) * 10, // metres
    "3.1": Math.round((7 + rnd(seed + 80) * 6) * boost), // kettlebell rounds
    "3.2": Math.round((6 + rnd(seed + 340) * 5) * boost), // dumbbell rounds
    "4.1": Math.floor(rnd(seed + 120) * 4), // minutes remaining
    "4.2": Math.floor(rnd(seed + 160) * 60), // seconds remaining
  };
}

/** Those values as ZoneEntry create rows. */
export function entryRows(inputIds: Map<string, string>, values: Record<string, number>) {
  return Object.entries(values)
    .map(([key, value]) => ({ inputId: inputIds.get(key), value }))
    .filter((row): row is { inputId: string; value: number } => Boolean(row.inputId));
}

export function normalizeName(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
