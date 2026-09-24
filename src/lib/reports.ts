import "server-only";

import { prisma } from "@/lib/prisma";
import { isCompeting } from "@/lib/team-status";
import { SCHEDULE_CATEGORIES, SCHEDULE_DIVISIONS } from "@/lib/wave-schedule";

// ─────────────────────────────────────────────────────────────────────────────
// THE FIGURES BFT MENA ACTUALLY ASKS FOR.
//
// Four different questions that are easy to confuse, and are counted here once
// so that no two screens can answer them differently:
//
//   REGISTERED   pairs who entered, paid or not
//   PAID         money confirmed — and the only ones the board shows
//   WAITING      entered after the deadline; holds no place until admitted
//   ATTENDED     turned up on the day
//   MEMBERS      people who hold a BFT studio membership
//
// MEMBERS counts PEOPLE, not teams, because a pair can be one member and one
// guest — which is the interesting case and the one a team-level count would
// quietly lose.
//
// WITHDRAWN REGISTRATIONS ARE NOT REGISTRATIONS. Every figure here excludes
// `archivedAt`, which it did not used to: a withdrawn pair was inside
// `registered`, `pending` and `inWave`, while the roster screen beside it
// (`getScopedRoster`) filtered them out — so the dashboard and the list it
// links to disagreed, and neither said why.
// ─────────────────────────────────────────────────────────────────────────────

export type SeriesReport = {
  byCategory: { category: string; total: number; levels: { division: string; count: number }[] }[];
  registered: number;
  paid: number;
  pending: number;
  refunded: number;
  /**
   * Entered after registration closed, holding no place yet.
   *
   * Counted separately because a waiting entry is not work to do on the
   * field: it has no wave ON PURPOSE, and it is not competing whatever its
   * money says. Folding it into the others is what made "N teams are not in
   * a wave" a notice that could never reach zero.
   */
  waiting: number;
  /** Entered, not withdrawn, and NOT waiting — the actual field. */
  inField: number;
  attended: number;
  scored: number;
  inWave: number;
  /** Money confirmed, in minor units. */
  takingsMinor: number;
  currency: string;
  people: {
    total: number;
    members: number;
    nonMembers: number;
  };
  byStudio: { id: string; name: string; teams: number; people: number }[];
  bySource: { source: string; count: number }[];
};

export async function getSeriesReport(seriesId: string): Promise<SeriesReport> {
  const [teams, competitors, studios] = await Promise.all([
    prisma.team.findMany({
      // Withdrawn entries are out of every figure — see the header.
      where: { seriesId, archivedAt: null },
      select: {
        id: true,
        category: true,
        division: true,
        paymentStatus: true,
        waitlistedAt: true,
        attendedAt: true,
        amountMinor: true,
        currency: true,
        source: true,
        studioId: true,
        waveId: true,
        score: { select: { status: true } },
      },
    }),
    prisma.competitor.findMany({
      where: { team: { seriesId, archivedAt: null } },
      select: { id: true, studioId: true },
    }),
    prisma.studio.findMany({ select: { id: true, name: true } }),
  ]);

  const paid = teams.filter(isCompeting);
  const inField = teams.filter((team) => team.waitlistedAt === null);
  const studioNames = new Map(studios.map((studio) => [studio.id, studio.name]));

  const teamsByStudio = new Map<string, number>();
  for (const team of teams) {
    if (!team.studioId) continue;
    teamsByStudio.set(team.studioId, (teamsByStudio.get(team.studioId) ?? 0) + 1);
  }

  const peopleByStudio = new Map<string, number>();
  for (const person of competitors) {
    if (!person.studioId) continue;
    peopleByStudio.set(person.studioId, (peopleByStudio.get(person.studioId) ?? 0) + 1);
  }

  const bySource = new Map<string, number>();
  for (const team of teams) bySource.set(team.source, (bySource.get(team.source) ?? 0) + 1);

  const members = competitors.filter((person) => person.studioId !== null).length;

  return {
    byCategory: SCHEDULE_CATEGORIES.map(category => ({
      category,
      total: inField.filter(team => team.category === category).length,
      levels: SCHEDULE_DIVISIONS.map(division => ({ division,
        count: inField.filter(team => team.category === category && team.division === division).length,
      })),
    })),
    registered: teams.length,
    paid: paid.length,
    // IN THE FIELD and unpaid. A waiting entry that has not paid is not
    // money to chase: it holds no place, and admitting it is a separate
    // decision that this figure must not quietly ask for.
    pending: inField.filter((team) => team.paymentStatus === "pending").length,
    refunded: teams.filter((team) => team.paymentStatus === "refunded").length,
    waiting: teams.filter((team) => team.waitlistedAt !== null).length,
    attended: teams.filter((team) => team.attendedAt !== null).length,
    scored: teams.filter((team) => team.score?.status === "submitted").length,
    inField: inField.length,
    // Counted over the field, not over everyone: a waiting entry is not
    // supposed to hold a wave, so including it makes a ratio that can never
    // reach its own denominator.
    inWave: inField.filter((team) => team.waveId !== null).length,

    takingsMinor: paid.reduce((sum, team) => sum + (team.amountMinor ?? 0), 0),
    // One event is priced in one currency; the first paid row settles it.
    currency: paid[0]?.currency ?? "QAR",

    people: {
      total: competitors.length,
      members,
      nonMembers: competitors.length - members,
    },

    byStudio: [...teamsByStudio.entries()]
      .map(([id, count]) => ({
        id,
        name: studioNames.get(id) ?? "—",
        teams: count,
        people: peopleByStudio.get(id) ?? 0,
      }))
      .sort((a, b) => b.teams - a.teams),

    bySource: [...bySource.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** "250.00 QAR" — an amount in minor units, for reading. */
export function money(minor: number | null, currency: string) {
  if (minor === null) return "—";
  return `${(minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}
