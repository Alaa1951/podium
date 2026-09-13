/**
 * WHAT THE THREE DEMO COMPETITIONS ARE.
 *
 * One competition cannot show what the system looks like before, during and
 * after, so the demo data carries one of each. Only the shapes and the data
 * live here; prisma/seed-scenarios.ts is what writes them.
 */

/**
 * The running order for a scenario. Waves are rows with their own clocks, so a
 * scenario says how many there are, how many have finished, and which are on
 * the floor — several may be, which is the case a single wave number could
 * never describe.
 */
export type WavePlan = {
  total: number;
  complete: number;
  /** Wave numbers on the floor right now. */
  running: number[];
  /** Default minutes; one wave is given its own to prove it is per-wave. */
  minutes: number;
  capacity: number;
};

export type Scenario = {
  name: string;
  slug: string;
  /** How many days from now the competition sits; negative is the past. */
  offsetDays: number;
  /** An absolute date, where the calendar matters more than the offset. */
  on?: Date;
  status: "scheduled" | "live" | "final";
  /** null = register nobody, for the upcoming event. */
  teamsPerBracket: number | null;
  /** Fraction of the field with a submitted score; 1 means every one. */
  scored: number;
  waves: WavePlan;
  resultsPublic: boolean;
};

export const SCENARIOS: Scenario[] = [
  {
    name: "PODIUM Series 1",
    slug: "podium-series-1",
    offsetDays: -21,
    status: "final",
    teamsPerBracket: 12,
    scored: 1, // every score in
    waves: { total: 12, complete: 12, running: [], minutes: 20, capacity: 9 },
    resultsPublic: true,
  },
  {
    name: "PODIUM Series 2",
    slug: "podium-series-2",
    offsetDays: 0, // opened this morning
    status: "live",
    teamsPerBracket: 12,
    scored: 0.62, // mid-competition
    // Two waves on the floor together: the floor panel turns between them every
    // fifteen seconds, which is the behaviour BFT MENA asked for.
    waves: { total: 12, complete: 6, running: [7, 8], minutes: 20, capacity: 9 },
    resultsPublic: false,
  },
  {
    name: "PODIUM Series 3",
    slug: "podium-series-3",
    offsetDays: 0,
    // The next one: 3 October 2026, 09:00 Qatar time.
    on: new Date("2026-10-03T09:00:00+03:00"),
    status: "scheduled",
    teamsPerBracket: null, // nothing registered yet
    scored: 0,
    waves: { total: 12, complete: 0, running: [], minutes: 20, capacity: 9 },
    resultsPublic: false,
  },
];

