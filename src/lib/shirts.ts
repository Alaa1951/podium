import { SHIRT_SIZES, type ShirtSizeValue } from "@/lib/shirt-sizes";

// ─────────────────────────────────────────────────────────────────────────────
// T-SHIRTS — how many of each size to order, and who wears which.
//
// Counted by SEAT: one shirt per athlete on a team that is still entered.
// The size comes from where it was most recently given:
//
//   1. the seat itself (Competitor.shirtSize — the CRM form, or pairing);
//   2. the athlete's own sign-up for this competition (SeriesParticipant);
//   3. for a partner with no account, what the registering athlete typed for
//      them at sign-up (SeriesParticipant.partnerShirtSize);
//   4. the athlete's profile (AthleteProfile).
//
// People signed up but not yet on a team are NOT counted: they may never be,
// and one of them may already sit on a team as somebody's partner — counting
// them too would order the same shirt twice. They are listed separately.
// Teams on the waiting list are counted in their own column, not the order.
//
// Pure: the loader gathers the rows and asks this.
// ─────────────────────────────────────────────────────────────────────────────

export type ShirtSeat = {
  teamNumber: number;
  teamName: string;
  athlete: string;
  studio: string | null;
  category: string;
  division: string;
  waveNumber: number | null;
  station: number | null;
  waitlisted: boolean;
  /** The size by the precedence above, already resolved. */
  size: ShirtSizeValue | null;
  /** Where the size came from, for anybody checking a surprising number. */
  source: "seat" | "signup" | "partner" | "profile" | null;
};

export type SizeCounts = Record<ShirtSizeValue, number> & { total: number };

const emptyCounts = (): SizeCounts => ({ ...Object.fromEntries(SHIRT_SIZES.map((size) => [size, 0])), total: 0 }) as SizeCounts;

export type ShirtSummary = {
  /** The order: every seat on an entered team, not on the waiting list. */
  field: SizeCounts;
  waitlisted: SizeCounts;
  byStudio: { studio: string; counts: SizeCounts }[];
  byGroup: { category: string; division: string; counts: SizeCounts }[];
  /** Seats with no size anywhere — somebody has to ask them. */
  missing: ShirtSeat[];
};

/** Pick the first size given, by the precedence in the header. */
export function resolveShirtSize(options: {
  seat: ShirtSizeValue | null;
  signup: ShirtSizeValue | null;
  partner: ShirtSizeValue | null;
  profile: ShirtSizeValue | null;
}): { size: ShirtSizeValue | null; source: ShirtSeat["source"] } {
  if (options.seat) return { size: options.seat, source: "seat" };
  if (options.signup) return { size: options.signup, source: "signup" };
  if (options.partner) return { size: options.partner, source: "partner" };
  if (options.profile) return { size: options.profile, source: "profile" };
  return { size: null, source: null };
}

export function summariseShirts(seats: ShirtSeat[]): ShirtSummary {
  const field = emptyCounts();
  const waitlisted = emptyCounts();
  const byStudio = new Map<string, SizeCounts>();
  const byGroup = new Map<string, { category: string; division: string; counts: SizeCounts }>();
  const missing: ShirtSeat[] = [];

  for (const seat of seats) {
    if (!seat.size) {
      missing.push(seat);
      continue;
    }
    if (seat.waitlisted) {
      waitlisted[seat.size] += 1;
      waitlisted.total += 1;
      continue;
    }
    field[seat.size] += 1;
    field.total += 1;

    const studio = seat.studio ?? "—";
    const studioCounts = byStudio.get(studio) ?? emptyCounts();
    studioCounts[seat.size] += 1;
    studioCounts.total += 1;
    byStudio.set(studio, studioCounts);

    const groupKey = `${seat.category}|${seat.division}`;
    const group = byGroup.get(groupKey) ?? { category: seat.category, division: seat.division, counts: emptyCounts() };
    group.counts[seat.size] += 1;
    group.counts.total += 1;
    byGroup.set(groupKey, group);
  }

  return {
    field,
    waitlisted,
    byStudio: [...byStudio.entries()]
      .map(([studio, counts]) => ({ studio, counts }))
      .sort((a, b) => a.studio.localeCompare(b.studio)),
    byGroup: [...byGroup.values()].sort(
      (a, b) => a.category.localeCompare(b.category) || a.division.localeCompare(b.division)
    ),
    missing: missing.sort((a, b) => a.teamNumber - b.teamNumber),
  };
}
