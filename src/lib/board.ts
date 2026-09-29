import "server-only";

import { onTheFloor } from "@/lib/ownership";
import type { Category, Division, SeriesStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getSeries, getSeriesTeams, getSeriesWaves, getSeriesZones } from "@/lib/queries";
import type { BoardDisplay } from "@/lib/visibility";
import { nextWaveStart, summariseWaves, type WaveState, type WaveSummary } from "@/lib/waves";
import { athletePhoto } from "@/lib/athlete-photo";
import { zoneSchedule, type PlannedWave } from "@/lib/floor";
import { formatQatarDayKey, parseQatarWallTime } from "@/lib/qatar-time";

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
  /** The rig (1–9) this team stands on in every zone of its wave. The station
   *  screens are addressed by (zone x station), and this is the second half. */
  station: number | null;
  competitors: string[];
  /**
   * One portrait per competitor, in the SAME ORDER as `competitors`. Resolved
   * on the server so a screen never decides what to load: every entry is a path
   * this app serves, default included (athlete-photo.ts).
   */
  portraits: string[];
  /** The pair in one picture — what a rig screen shows above the name. */
  groupPortrait: string | null;
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
  /**
   * The wave the floor is waiting for when none is running, with the time to
   * its scheduled start as a duration (negative once due). Null when every
   * wave has been run.
   */
  nextWave: { number: number; startsInMs: number | null } | null;
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
  /**
   * For each zone, the next wave to reach it and how long until it does —
   * a duration, like every other time here. What an idle rig screen shows
   * ("Up next"). An estimate while that wave has not started.
   */
  upNext: { zoneNumber: number; wave: number; inMs: number; estimated: boolean }[];
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
  // …and, once the incomplete-team policy is on, only a full pair (D3b).
  const onBoard = teams.filter((team) => onTheFloor(team));

  // Up next, per zone: the same arithmetic as the judge sheet (floor.ts).
  const ordered = [...zones].sort((a, b) => a.number - b.number);
  const timing = { workMinutes: series.zoneWorkMinutes, breakMinutes: series.zoneBreakMinutes, zoneCount: ordered.length };
  const day = formatQatarDayKey(series.competitionDate);
  const planned: PlannedWave[] = waves.map((wave) => ({
    id: wave.id,
    number: wave.number,
    status: wave.status,
    startedAt: wave.startedAt ? new Date(wave.startedAt) : null,
    endsAt: wave.endsAt ? new Date(wave.endsAt) : null,
    plannedStart: parseQatarWallTime(`${day}T${wave.startTime}`),
    hasTeams: wave.teamCount > 0,
  }));
  const at = new Date(now);
  const upNext = ordered.flatMap((zone, index) => {
    const visit = zoneSchedule(planned, index, timing, at).find((row) => row.state === "coming");
    return visit ? [{ zoneNumber: zone.number, wave: visit.number, inMs: visit.workStartsAt.getTime() - now, estimated: visit.estimated }] : [];
  });

  return {
    seriesId: series.id,
    seriesName: series.name,
    competitionDate: series.competitionDate.toISOString(),
    status: series.status,
    waves,
    waveSummary: summariseWaves(waves),
    nextWave: nextWaveStart(waves, series.competitionDate, now),
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
    upNext,
    teams: onBoard.map((team) => {
      return {
        id: team.id,
        number: team.number,
        name: team.name,
        category: team.category,
        division: team.division,
        wave: team.wave,
        station: team.station,
        competitors: team.competitors.map((a) => a.fullName),
        portraits: team.competitors.map((a) => athletePhoto(a.photoPath)),
        groupPortrait: team.groupPortraitPath ? athletePhoto(team.groupPortraitPath) : null,
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
