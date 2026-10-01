import type { Category, Division } from "@/generated/prisma/enums";
import { BRACKETS } from "@/lib/scoring";
import { matchesSearch } from "@/lib/search";
import { waiverSatisfied, type WaiverState } from "@/lib/waivers/status";

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO CHECK-INS OF THE DAY, and the figures on their screens.
//
//   ENTRANCE   who has ARRIVED at the venue. Recorded per person, because a
//              pair does not always arrive together: a team is "checked in"
//              only when every one of its athletes is — one of two at the
//              door is a PARTIAL arrival, shown as such, and the absent
//              partner is never counted as present.
//   WARM-UP    which teams are READY TO COMPETE, wave by wave. A separate
//              fact, stored separately: arriving never makes a team ready,
//              and marking it ready never touches its arrival.
//
// Teams and athletes are counted apart and labelled apart — "12 teams" and
// "23 athletes" are different answers to different questions.
//
// Pure: the screens and the tests ask the same functions, so a count on a
// card is always the count of the rows under it.
// ─────────────────────────────────────────────────────────────────────────────

export type ArrivalStatus = "in" | "partial" | "out";

export type CheckInAthlete = {
  id: string;
  fullName: string;
  arrived: boolean;
  /** Their own signature of the competition's waiver — the state, never the signature. */
  waiver: WaiverState;
};

export type CheckInTeam = {
  id: string;
  number: number;
  name: string;
  category: Category;
  division: Division;
  studio: string | null;
  waveId: string | null;
  waveNumber: number | null;
  station: number | null;
  /** Paid and holding a place — an unpaid pair still has to be found at the door. */
  competing: boolean;
  athletes: CheckInAthlete[];
  /** Ready to compete (warm-up) in the wave it is in now. Never derived from arrival. */
  ready: boolean;
  /** Runs in another category's block (a scheduling exception); it still competes in its own. */
  outsideBlock?: boolean;
  /** The block its wave runs in, when that is not its own. */
  hostBlock?: Category | null;
};

/** Everyone here, some of them, or nobody. A team with no athletes has not arrived. */
export function arrivalStatus(team: Pick<CheckInTeam, "athletes">): ArrivalStatus {
  const here = team.athletes.filter((athlete) => athlete.arrived).length;
  if (here > 0 && here === team.athletes.length) return "in";
  return here > 0 ? "partial" : "out";
}

export type CheckInTotals = {
  teams: {
    registered: number;
    checkedIn: number;
    /** Every team not fully here yet — the partly arrived ones included. */
    notCheckedIn: number;
    /** Of those, the teams with somebody here and somebody missing. */
    partial: number;
  };
  athletes: { registered: number; checkedIn: number; notCheckedIn: number };
};

export function checkInTotals(teams: readonly CheckInTeam[]): CheckInTotals {
  const statuses = teams.map(arrivalStatus);
  const checkedIn = statuses.filter((status) => status === "in").length;
  const athletes = teams.flatMap((team) => team.athletes);
  const here = athletes.filter((athlete) => athlete.arrived).length;
  return {
    teams: {
      registered: teams.length,
      checkedIn,
      notCheckedIn: teams.length - checkedIn,
      partial: statuses.filter((status) => status === "partial").length,
    },
    athletes: { registered: athletes.length, checkedIn: here, notCheckedIn: athletes.length - here },
  };
}

export type BracketTotals = { category: Category; division: Division } & CheckInTotals;

/** The same figures per category and level, in board order; empty brackets left out. */
export function totalsByBracket(teams: readonly CheckInTeam[]): BracketTotals[] {
  return BRACKETS.flatMap(({ category, division }) => {
    const inBracket = teams.filter((team) => team.category === category && team.division === division);
    return inBracket.length ? [{ category, division, ...checkInTotals(inBracket) }] : [];
  });
}

const searchFields = (team: CheckInTeam) => ({
  text: [team.name, team.studio, ...team.athletes.map((athlete) => athlete.fullName)],
  exact: [team.number],
});

const inBracket = (team: CheckInTeam, filter: { category: string; division: string }) =>
  (!filter.category || filter.category === "all" || team.category === filter.category) &&
  (!filter.division || filter.division === "all" || team.division === filter.division);

/** Everybody on the team has signed (or no waiver is asked for). */
export const waiversDone = (team: Pick<CheckInTeam, "athletes">) => team.athletes.every((athlete) => waiverSatisfied(athlete.waiver));

/** `waiver`: all · signed (every athlete) · pending (somebody has not). */
const matchesWaiver = (team: CheckInTeam, waiver: string | undefined) =>
  !waiver || waiver === "all" || (waiver === "signed" ? waiversDone(team) : !waiversDone(team));

/** `status`: all · in (everyone here) · pending (not fully here) · partial. */
export type EntranceFilter = { q: string; category: string; division: string; status: string; waiver?: string };

export function matchesEntrance(team: CheckInTeam, filter: EntranceFilter): boolean {
  if (!inBracket(team, filter) || !matchesWaiver(team, filter.waiver)) return false;
  const status = arrivalStatus(team);
  if (filter.status === "in" && status !== "in") return false;
  if (filter.status === "pending" && status === "in") return false;
  if (filter.status === "partial" && status !== "partial") return false;
  return matchesSearch(filter.q, searchFields(team));
}

/** `wave`: all · a wave id · none (not placed yet). `readiness`: all · ready · pending. */
export type WarmupFilter = { q: string; category: string; division: string; wave: string; readiness: string; waiver?: string };

export function matchesWarmup(team: CheckInTeam, filter: WarmupFilter): boolean {
  if (!inBracket(team, filter) || !matchesWaiver(team, filter.waiver)) return false;
  if (filter.wave === "none" && team.waveId !== null) return false;
  if (filter.wave && filter.wave !== "all" && filter.wave !== "none" && team.waveId !== filter.wave) return false;
  if (filter.readiness === "ready" && !team.ready) return false;
  if (filter.readiness === "pending" && team.ready) return false;
  return matchesSearch(filter.q, searchFields(team));
}

export type WarmupWave = { id: string; number: number; startTime: string; status: "pending" | "running" | "complete" };

export type WarmupGroup = {
  /** Null for the teams not placed in a wave yet. */
  wave: WarmupWave | null;
  teams: CheckInTeam[];
  ready: number;
  pending: number;
};

export function warmupTotals(teams: readonly CheckInTeam[]): { teams: number; ready: number; pending: number } {
  const ready = teams.filter((team) => team.ready).length;
  return { teams: teams.length, ready, pending: teams.length - ready };
}

/**
 * One checklist per wave — the event's own grouping — in running order, each
 * by station; then the teams with no wave yet. Waves with none of these teams
 * are left out.
 */
export function warmupGroups(teams: readonly CheckInTeam[], waves: readonly WarmupWave[]): WarmupGroup[] {
  const byStation = (a: CheckInTeam, b: CheckInTeam) => (a.station ?? 99) - (b.station ?? 99) || a.number - b.number;
  const group = (wave: WarmupWave | null, members: CheckInTeam[]): WarmupGroup => {
    const totals = warmupTotals(members);
    return { wave, teams: [...members].sort(byStation), ready: totals.ready, pending: totals.pending };
  };
  const known = new Set(waves.map((wave) => wave.id));
  const groups = [...waves]
    .sort((a, b) => a.number - b.number)
    .map((wave) => group(wave, teams.filter((team) => team.waveId === wave.id)))
    .filter((one) => one.teams.length > 0);
  const unplaced = teams.filter((team) => !team.waveId || !known.has(team.waveId));
  return unplaced.length ? [...groups, group(null, unplaced)] : groups;
}
