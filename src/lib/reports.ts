import "server-only";

import { prisma } from "@/lib/prisma";
import { isCompeting } from "@/lib/team-status";

// ─────────────────────────────────────────────────────────────────────────────
// THE FIGURES BFT MENA ACTUALLY ASKS FOR.
//
// Four different questions that are easy to confuse, and are counted here once
// so that no two screens can answer them differently:
//
//   REGISTERED   pairs who entered, paid or not
//   PAID         money confirmed — and the only ones the board shows
//   ATTENDED     turned up on the day
//   MEMBERS      people who hold a BFT studio membership
//
// The last one counts PEOPLE, not teams, because a pair can be one member and
// one guest — which is the interesting case and the one a team-level count
// would quietly lose.
// ─────────────────────────────────────────────────────────────────────────────

export type SeriesReport = {
  registered: number;
  paid: number;
  pending: number;
  refunded: number;
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
      where: { seriesId },
      select: {
        id: true,
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
      where: { team: { seriesId } },
      select: { id: true, studioId: true },
    }),
    prisma.studio.findMany({ select: { id: true, name: true } }),
  ]);

  const paid = teams.filter(isCompeting);
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
    registered: teams.length,
    paid: paid.length,
    pending: teams.filter((team) => team.paymentStatus === "pending").length,
    refunded: teams.filter((team) => team.paymentStatus === "refunded").length,
    attended: teams.filter((team) => team.attendedAt !== null).length,
    scored: teams.filter((team) => team.score?.status === "submitted").length,
    inWave: teams.filter((team) => team.waveId !== null).length,

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
