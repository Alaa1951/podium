import "server-only";

import { prisma } from "@/lib/prisma";
import { getSeries, getSeriesWaves } from "@/lib/queries";
import { summariseWaves, type WaveState, type WaveSummary } from "@/lib/waves";
import { boardAccess, eventPhase, registrationOpen, scoreEntryOpen, type EventPhase } from "@/lib/visibility";
import type { CurrentUser } from "@/lib/access";

/**
 * Where a competition is, and what this person may therefore do with it.
 *
 * Several screens used to work this out for themselves and did not all agree.
 * There is one answer and it is computed here, from the wave rows, once per
 * request.
 */
export type SeriesState = {
  series: NonNullable<Awaited<ReturnType<typeof getSeries>>>;
  waves: WaveState[];
  waveSummary: WaveSummary;
  teamCount: number;
  phase: EventPhase;
};

/** Takes a series id OR the slug in its URL, which is what pages have. */
export async function getSeriesState(idOrSlug: string): Promise<SeriesState | null> {
  const series = await getSeries(idOrSlug);
  if (!series) return null;

  // Everything below keys off the resolved ID. Passing the slug on from here
  // silently returns nothing — no waves, no teams — and a live competition
  // then reads as "not started", which is how this was found.
  const [waves, teamCount] = await Promise.all([
    getSeriesWaves(series.id),
    prisma.team.count({ where: { seriesId: series.id } }),
  ]);

  const waveSummary = summariseWaves(waves);

  return {
    series,
    waves,
    waveSummary,
    teamCount,
    phase: eventPhase({
      status: series.status,
      teamCount,
      wavesTotal: waveSummary.total,
      wavesComplete: waveSummary.complete,
      wavesRunning: waveSummary.running,
      boardOpensAt: series.boardOpensAt,
      resultsPublicAt: series.resultsPublicAt,
      now: new Date(),
    }),
  };
}

/** The same state, plus what this particular person may see and do. */
export function accessFor(state: SeriesState, user: CurrentUser) {
  const now = new Date();

  return {
    ...boardAccess(user.role, state.phase),
    registration: registrationOpen({
      role: user.role,
      registrationClosesAt: state.series.registrationClosesAt,
      now,
    }),
    scoreEntry: scoreEntryOpen({
      role: user.role,
      scoreEntryClosesAt: state.series.scoreEntryClosesAt,
      now,
    }),
  };
}
