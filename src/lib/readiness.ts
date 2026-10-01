import { waiverSatisfied, type WaiverState } from "@/lib/waivers/status";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT STANDS BETWEEN A TEAM AND ITS WAVE — three facts kept apart, checked
// in order, for every athlete on the team:
//
//   WAIVER     their own signature of the competition's current waiver
//              (waivers/status.ts); nobody else's covers them.
//   ENTRANCE   they are at the venue now (checked in, not checked out).
//   WARM-UP    the TEAM is ready, for THIS wave — readiness given for another
//              wave does not carry over when the team is moved.
//
// Entrance check-in needs the waiver; warm-up check-in needs the waiver and
// the entrance; Start Wave needs all three for every athlete of every team in
// the wave. Nothing here drops an athlete or a team to make a wave startable:
// a gap is reported, by team and by athlete, for a person to resolve.
//
// Pure: the desks, Wave control and the server ask the same functions.
// ─────────────────────────────────────────────────────────────────────────────

export type AthleteGap =
  /** The seat has no PODIUM account to sign with. */
  | "account"
  | "waiver"
  /** Signed an earlier version; the current one is not signed yet. */
  | "waiver_resign"
  | "entrance";

export type TeamGap =
  /** Withdrawn, or on the waiting list. */
  | "registration"
  | "no_athletes"
  | "no_wave"
  /** Not ready in warm-up for this wave. */
  | "warmup";

export type AthleteCheck = { id: string; name: string; waiver: WaiverState; arrived: boolean };

export type TeamCheck = {
  id: string;
  number: number;
  name: string;
  /** Registered and holding a place: not withdrawn, not on the waiting list. */
  inField: boolean;
  waveId: string | null;
  /** The wave the team was made ready for; null when it is not ready. */
  readyForWaveId: string | null;
  athletes: AthleteCheck[];
};

export type AthleteGaps = { id: string; name: string; gaps: AthleteGap[] };
export type TeamGaps = { team: { id: string; number: number; name: string }; gaps: TeamGap[]; athletes: AthleteGaps[] };

export function waiverGap(state: WaiverState): AthleteGap | null {
  if (waiverSatisfied(state)) return null;
  if (state === "no_account") return "account";
  if (state === "resign") return "waiver_resign";
  return "waiver";
}

/** Entrance check-in: the waiver, athlete by athlete. */
export function entranceGaps(athletes: readonly AthleteCheck[]): AthleteGaps[] {
  return athletes.flatMap((athlete) => {
    const gap = waiverGap(athlete.waiver);
    return gap ? [{ id: athlete.id, name: athlete.name, gaps: [gap] }] : [];
  });
}

function athleteGaps(athlete: AthleteCheck): AthleteGap[] {
  const gaps: AthleteGap[] = [];
  const waiver = waiverGap(athlete.waiver);
  if (waiver) gaps.push(waiver);
  if (!athlete.arrived) gaps.push("entrance");
  return gaps;
}

function teamRegistrationGaps(team: TeamCheck): TeamGap[] {
  const gaps: TeamGap[] = [];
  if (!team.inField) gaps.push("registration");
  if (!team.athletes.length) gaps.push("no_athletes");
  return gaps;
}

/** Warm-up check-in: registered, placed in a wave, and every athlete signed and here. */
export function warmupGaps(team: TeamCheck): TeamGaps {
  const gaps = teamRegistrationGaps(team);
  if (!team.waveId) gaps.push("no_wave");
  return {
    team: { id: team.id, number: team.number, name: team.name },
    gaps,
    athletes: team.athletes.map((athlete) => ({ id: athlete.id, name: athlete.name, gaps: athleteGaps(athlete) })).filter((one) => one.gaps.length),
  };
}

/** Ready counts only for the wave it was given for. */
export const readyFor = (team: Pick<TeamCheck, "readyForWaveId" | "waveId">) => team.readyForWaveId !== null && team.readyForWaveId === team.waveId;

/** Start Wave: everything, for every athlete of every team in the wave. Only teams with a gap are listed. */
export function startBlockers(teams: readonly TeamCheck[], waveId: string): TeamGaps[] {
  return teams.flatMap((team) => {
    const result = warmupGaps({ ...team, waveId });
    if (team.readyForWaveId !== waveId) result.gaps.push("warmup");
    return result.gaps.length || result.athletes.length ? [result] : [];
  });
}

export const hasGaps = (result: TeamGaps) => result.gaps.length > 0 || result.athletes.length > 0;
