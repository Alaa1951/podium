import { BRACKETS, bracketLabel } from "@/lib/scoring";
import type { BoardTeam } from "@/lib/board";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE BOARD IS CURRENTLY SHOWING.
//
// The operator board can be pointed at one bracket, at whatever is on the floor,
// or at the whole field, and the heading, the figures and the progress bar all
// have to agree about which. That agreement is worked out here, away from the
// rendering, so there is one answer rather than three that happen to match.
// ─────────────────────────────────────────────────────────────────────────────

/** The two selections that are not a bracket. */
export const ALL_TEAMS = -1;
export const ON_FLOOR = -2;

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Which brackets have a submitted score in them — the rest are dimmed. */
export function populatedBrackets(teams: BoardTeam[]) {
  return BRACKETS.map((bracket, index) =>
    teams.some(
      (team) =>
        team.submitted &&
        team.category === bracket.category &&
        team.division === bracket.division
    )
      ? index
      : -1
  ).filter((index) => index >= 0);
}

/**
 * One ranking out of several brackets: every team whose bracket is marked,
 * whether or not it has scored yet — the caller filters to submitted rows
 * when it wants the ones that count.
 */
export function markedBracketsTeams(teams: BoardTeam[], marks: number[], reached: number) {
  const chosen = marks.map((index) => BRACKETS[index]);
  return teams.filter(
    (team) =>
      team.wave <= reached &&
      chosen.some((bracket) => team.category === bracket.category && team.division === bracket.division)
  );
}

/** The combined scope's name, in the operator's own order. */
export function markedBracketsLabel(marks: number[], t: Translate) {
  return marks
    .map((index) => {
      const bracket = BRACKETS[index];
      return `${t(bracket.category)} ${t(bracket.division)}`;
    })
    .join(" + ");
}

/** The teams the current selection covers. */
export function teamsInScope(params: {
  teams: BoardTeam[];
  selection: number;
  reached: number;
  runningNumbers: number[];
}) {
  const { teams, selection, reached, runningNumbers } = params;

  if (selection === ALL_TEAMS) return teams.filter((team) => team.wave <= reached);
  if (selection === ON_FLOOR) return teams.filter((team) => runningNumbers.includes(team.wave));

  const bracket = BRACKETS[selection];
  return teams.filter(
    (team) =>
      team.category === bracket.category &&
      team.division === bracket.division &&
      team.wave <= reached
  );
}

/** The heading, which names the selection rather than the competition. */
export function scopeTitle(params: {
  t: Translate;
  selection: number;
  reached: number;
  runningNumbers: number[];
}) {
  const { t, selection, reached, runningNumbers } = params;

  if (selection === ON_FLOOR) {
    return runningNumbers.length > 1
      ? `${t("On the floor")} · ${t("Waves")} ${runningNumbers.join(" + ")}`
      : `${t("Wave")} ${runningNumbers[0] ?? reached} · ${t("On the floor")}`;
  }
  if (selection === ALL_TEAMS) {
    return `${t("Overall")} · ${t("Waves")} 1–${Math.max(1, reached)}`;
  }
  return bracketLabel(BRACKETS[selection].category, BRACKETS[selection].division);
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
