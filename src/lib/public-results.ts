import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getSeriesTeams,
  getSeriesZones,
  rankBracket,
  type RankedTeam,
  type TeamRow,
} from "@/lib/queries";
import type { Category, Division } from "@/generated/prisma/enums";
import { isCompeting } from "@/lib/team-status";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE PUBLIC MAY READ.
//
// A separate door from the console's, deliberately. Everything here answers
// one question — "which competitions are finished and published, and what did
// they end up as" — and it cannot answer any other, because it never loads
// anything else.
//
// A competition appears here only when it is FINAL and its publication time has
// passed. Before that the results are the competitors' own business, and the
// console is where they live.
// ─────────────────────────────────────────────────────────────────────────────

/** Competitions whose results are published, newest first. */
export async function publishedCompetitions() {
  const now = new Date();

  return prisma.series.findMany({
    where: {
      status: "final",
      // Publishing is explicit: null means "no publication time set", the same
      // rule visibility.ts applies — finished but still competitor-only until
      // BFT MENA names the moment the results go open.
      resultsPublicAt: { lte: now },
    },
    orderBy: { competitionDate: "desc" },
    select: {
      id: true,
      slug: true,
      name: true,
      competitionDate: true,
      showTeamName: true,
      showCompetitorNames: true,
      showStudioColumn: true,
      sponsorsEnabled: true,
      sponsors: {
        orderBy: { position: "asc" },
        select: { id: true, alt: true },
      },
    },
  });
}

/** One published competition, or null — including when it is not published. */
export async function publishedCompetition(slug: string) {
  const all = await publishedCompetitions();
  return all.find((one) => one.slug === slug) ?? null;
}

/**
 * The teams on a published board.
 *
 * Paid and submitted only, ranked inside the bracket. Unpaid entries and
 * unsubmitted scores are not results — publishing them would put somebody on a
 * public page for a competition they did not complete.
 */
export async function publishedBoard(
  seriesId: string,
  category: Category,
  division: Division
): Promise<RankedTeam[]> {
  const teams = await getSeriesTeams(seriesId);
  const onBoard = teams.filter(isCompeting);
  return rankBracket(onBoard, category, division);
}

/** One team's published result, with the movements behind its total. */
export async function publishedTeam(seriesId: string, teamId: string) {
  const teams = await getSeriesTeams(seriesId);
  const onBoard = teams.filter((team) => isCompeting(team) && team.submitted);

  const found = onBoard.find((one) => one.id === teamId);
  if (!found) return null;

  const ranked = rankBracket(onBoard, found.category, found.division);
  const rank = ranked.find((one) => one.id === teamId)?.rank ?? 0;
  const fieldSize = ranked.length;

  const definition = await getSeriesZones(seriesId);

  const zones = definition.map((zone) => ({
    number: zone.number,
    name: zone.name,
    points: found.zones.find((one) => one.number === zone.number)?.points ?? 0,
    inputs: zone.inputs.map((input) => ({
      label: input.label,
      unit: input.unit,
      value: found.values[input.id] ?? null,
    })),
  }));

  // The public shape only: exactly what the team page renders. Competitor
  // contact details and registration payloads stay behind the console door
  // even though this function already filtered to paid, submitted teams.
  const team = {
    name: found.name,
    category: found.category,
    division: found.division,
    total: found.total,
    studioName: found.studioName,
    competitors: found.competitors.map((person) => ({ fullName: person.fullName })),
  };

  return { team, rank, fieldSize, zones };
}

/** The studios with a team on this board, for its filter. */
export function studiosOn(rows: TeamRow[]) {
  return [...new Set(rows.map((row) => row.studioName).filter(Boolean))].sort() as string[];
}

// ── One board, two doors ─────────────────────────────────────────────────────
// The public leaderboard page and its poll endpoint render the exact same
// view, so both go through this one builder. It returns only what the screen
// shows: ranks, names the event chose to publish, and totals — no contact
// details, no registration data, nothing about unpaid or unscored teams.

export type PublicBoardRow = {
  id: string;
  rank: number;
  name: string;
  competitors: string[];
  studioName: string | null;
  total: number;
};

export type PublishedBoardView = {
  seriesName: string;
  seriesSlug: string;
  showCompetitorNames: boolean;
  showStudioColumn: boolean;
  rows: PublicBoardRow[];
  studios: string[];
  /**
   * The event's sponsor rail, in order, pointing at the public logo route —
   * empty when the event's rail is switched off.
   */
  sponsors: { src: string; alt: string }[];
  /** Whether the sponsor rail shows at all; off means brand-only screens. */
  sponsorsEnabled: boolean;
};

export async function publishedBoardView(
  slug: string,
  category: Category,
  division: Division
): Promise<PublishedBoardView | null> {
  const competition = await publishedCompetition(slug);
  if (!competition) return null;

  const ranked = await publishedBoard(competition.id, category, division);

  return {
    seriesName: competition.name,
    seriesSlug: competition.slug,
    showCompetitorNames: competition.showCompetitorNames,
    showStudioColumn: competition.showStudioColumn,
    rows: ranked.map((team) => ({
      id: team.id,
      rank: team.rank,
      name: team.name,
      competitors: team.competitors.map((person) => person.fullName),
      studioName: competition.showStudioColumn ? team.studioName : null,
      total: team.total,
    })),
    studios: competition.showStudioColumn ? studiosOn(ranked) : [],
    sponsors: competition.sponsorsEnabled
      ? competition.sponsors.map((sponsor) => ({
          src: `/api/sponsors/${sponsor.id}/logo`,
          alt: sponsor.alt,
        }))
      : [],
    sponsorsEnabled: competition.sponsorsEnabled,
  };
}
