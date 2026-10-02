import { BRACKETS, bracketIndex, rankAll } from "@/lib/scoring";
import { SCHEDULE_CATEGORIES, SCHEDULE_DIVISIONS } from "@/lib/wave-schedule";
import type { BoardTeam } from "@/lib/board";
import type { RotationStop } from "@/lib/board-rotation";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE BOARD IS CURRENTLY SHOWING.
//
// A playlist of independent prize brackets. Marks restrict that playlist;
// ranks, the heading and the progress bar always belong to ONE bracket.
// ─────────────────────────────────────────────────────────────────────────────

export const ROWS_PER_PAGE = 12;

/** Men, Mixed, Women; Rookie, Open, Pro within each category. */
export const LIVE_BRACKET_ORDER = SCHEDULE_CATEGORIES.flatMap((category) =>
  SCHEDULE_DIVISIONS.map((division) => bracketIndex(category, division)),
);

export type BracketView = {
  index: number;
  teams: BoardTeam[];
  rows: (BoardTeam & { rank: number })[];
};

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Published zone scores enter their prize bracket regardless of wave state or assignment. */
export function bracketViews(teams: BoardTeam[]): BracketView[] {
  return LIVE_BRACKET_ORDER.map((index) => {
    const bracket = BRACKETS[index];
    const pool = teams.filter((team) => team.category === bracket.category && team.division === bracket.division);
    return { index, teams: pool, rows: rankAll(pool.filter((team) => team.scored)) };
  });
}

/** Marks restrict a playlist, never combine scores. Empty brackets wait. */
export function bracketStops(views: readonly BracketView[], marks: readonly number[]): RotationStop[] {
  return views
    .filter((view) => view.rows.length > 0 && (marks.length === 0 || marks.includes(view.index)))
    .map((view) => ({ id: view.index, pages: Math.ceil(view.rows.length / ROWS_PER_PAGE) }));
}

export function firstMarkedBracket(marks: readonly number[]) {
  return LIVE_BRACKET_ORDER.find((index) => marks.includes(index)) ?? null;
}

/** Observing a station never implies a combined podium. */
export function stationOrder(teams: readonly BoardTeam[]) {
  return [...teams].sort((a, b) => (a.station ?? 99) - (b.station ?? 99) || a.number - b.number);
}

/** Where the day is, in one phrase, for the wall. */
export function waveStateLabel(params: {
  t: Translate;
  teamCount: number;
  summary: { total: number; running: number; complete: number };
}) {
  const { t, teamCount, summary } = params;

  if (!teamCount) return t("Awaiting teams");
  if (summary.running > 1) return t("{n} waves on the floor", { n: summary.running });
  if (summary.running === 1) return t("On the floor now");
  if (summary.total > 0 && summary.complete >= summary.total) return t("All waves complete");
  // Nothing running and a wave still to go: the floor is waiting for it, and
  // the clock beside this counts down to its scheduled start.
  return t("Up next");
}
