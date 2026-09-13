import "server-only";

import type { Category, Division, SeriesStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getSeries, getSeriesTeams, getSeriesWaves, getSeriesZones } from "@/lib/queries";
import type { BoardDisplay } from "@/lib/visibility";
import { summariseWaves, type WaveState, type WaveSummary } from "@/lib/waves";

// One payload shape for the board, built once on the server and reused by the
// page's first render and by the polling endpoint that keeps it fresh. Only
// what the board shows is included — no studio ids, no account data.

export type BoardTeam = {
  id: string;
  number: number;
  name: string;
  category: Category;
  division: Division;
  wave: number;
  competitors: string[];
  studioName: string | null;
  submitted: boolean;
  /** Points per zone, in board order — as many as the series defines. The
   *  board used to carry four named fields and could only draw Series 1. */
  zones: { number: number; name: string; points: number }[];
  total: number;
};

export type BoardPayload = {
  seriesId: string;
  /** The competition's name — what the board calls itself. */
  seriesName: string;
  competitionDate: string;
  status: SeriesStatus;
  /** Every wave, each with its own clock, capacity and length. */
  waves: WaveState[];
  waveSummary: WaveSummary;
  /** The series' zone definition, so the board can label its own columns. */
  zoneDefs: { id: string; number: number; name: string }[];
  /** Default length for a new wave; each wave carries its own. */
  waveMinutes: number;
  /**
   * Durations, not instants. The board anchors them against its own clock the
   * moment they arrive, so a venue screen whose system time is wrong still
   * counts down exactly as long as everyone else's.
   */
  /** Negative once the board has opened; null when no unlock time is set. */
  boardOpensInMs: number | null;
  /** How a team is labelled on this board — set per event by BFT MENA. */
  display: BoardDisplay;
  /** Every studio with a team in this event, for the board's filter. */
  studios: string[];
  /**
   * The event's sponsor marks, in rail order — empty when the event's rail is
   * switched off. `src` points at the public logo route so any screen, signed
   * in or not, can draw them.
   */
  sponsors: { src: string; alt: string }[];
  /** Whether the sponsor rail shows at all; off means brand-only screens. */
  sponsorsEnabled: boolean;
  teams: BoardTeam[];
};

/**
 * A deadline as a remaining duration. Screens anchor it against their own clock
 * on arrival, so nothing in the venue depends on a device's system time.
 */
export function remainingMs(endsAt: Date | null | undefined) {
  if (!endsAt) return null;
  return Math.max(0, endsAt.getTime() - Date.now());
}

/** Takes a series id OR the slug in its URL. */
export async function buildBoardPayload(idOrSlug: string): Promise<BoardPayload | null> {
  const series = await getSeries(idOrSlug);
  if (!series) return null;

  // The resolved ID from here on: a slug matches no foreign key, and the
  // board would quietly come back empty rather than failing.
  const teams = await getSeriesTeams(series.id);
  const waves = await getSeriesWaves(series.id);
  const zones = await getSeriesZones(series.id);
  const sponsors = series.sponsorsEnabled
    ? await prisma.sponsor.findMany({
        where: { seriesId: series.id },
        orderBy: { position: "asc" },
        select: { id: true, alt: true },
      })
    : [];
  const now = Date.now();

  // Only a PAID registration reaches the board. An unpaid one is still a real
  // registration everywhere else — on the roster, in the reports, in a wave —
  // which is why it is a status on the row and not a missing row.
  const onBoard = teams.filter((team) => team.paymentStatus === "paid");

  return {
    seriesId: series.id,
    seriesName: series.name,
    competitionDate: series.competitionDate.toISOString(),
    status: series.status,
    waves,
    waveSummary: summariseWaves(waves),
    zoneDefs: zones.map((zone) => ({ id: zone.id, number: zone.number, name: zone.name })),
    waveMinutes: series.waveMinutes,
    boardOpensInMs: series.boardOpensAt ? series.boardOpensAt.getTime() - now : null,
    display: {
      showTeamName: series.showTeamName,
      showCompetitorNames: series.showCompetitorNames,
      showStudioColumn: series.showStudioColumn,
    },
    studios: [...new Set(onBoard.map((team) => team.studioName).filter(Boolean))].sort() as string[],
    sponsors: sponsors.map((sponsor) => ({
      src: `/api/sponsors/${sponsor.id}/logo`,
      alt: sponsor.alt,
    })),
    sponsorsEnabled: series.sponsorsEnabled,
    teams: onBoard.map((team) => {
      return {
        id: team.id,
        number: team.number,
        name: team.name,
        category: team.category,
        division: team.division,
        wave: team.wave,
        competitors: team.competitors.map((a) => a.fullName),
        studioName: team.studioName,
        submitted: team.submitted,
        zones: team.zones.map((zone) => ({
          number: zone.number,
          name: zone.name,
          points: zone.points,
        })),
        total: team.total,
      };
    }),
  };
}
