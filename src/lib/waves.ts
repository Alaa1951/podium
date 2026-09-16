import type { WaveStatus } from "@/generated/prisma/enums";

// ─────────────────────────────────────────────────────────────────────────────
// WAVES.
//
// A wave used to be a number on the event and a single boolean — which could
// only ever describe one wave on the floor. It is now a row with its own
// capacity, its own length and its own clock, so:
//
//   * an operator presses START on a wave, not "next";
//   * several waves can be running at the same time;
//   * one wave can be twenty minutes of nine teams and the next fifteen of
//     five, without either being a special case.
//
// Pure and dependency-free, so the rules are testable on their own.
// ─────────────────────────────────────────────────────────────────────────────

export type WaveState = {
  id: string;
  number: number;
  status: WaveStatus;
  capacity: number;
  durationMinutes: number;
  /** Scheduled start as HH:mm — the plan, not the clock. */
  startTime: string;
  /** Time left on a running wave. Null when it has not started or has ended. */
  remainingMs: number | null;
  /** When the clock runs out — the finisher stop reads it. Null if not run. */
  endsAt: string | null;
  /** What a manually stopped wave still had on the clock — frozen for display. */
  stoppedRemainingMs: number | null;
  teamCount: number;
  scoredCount: number;
};

export type WaveSummary = {
  total: number;
  pending: number;
  running: number;
  complete: number;
  /** The waves on the floor right now, in order. */
  runningNumbers: number[];
  /**
   * The highest wave that has been started at all. This is what "the field so
   * far" means on the board — a team in a wave nobody has run yet is not
   * missing a score, it simply has not competed.
   */
  reached: number;
};

export function summariseWaves(waves: WaveState[]): WaveSummary {
  const running = waves.filter((w) => w.status === "running");
  const started = waves.filter((w) => w.status !== "pending");

  return {
    total: waves.length,
    pending: waves.filter((w) => w.status === "pending").length,
    running: running.length,
    complete: waves.filter((w) => w.status === "complete").length,
    runningNumbers: running.map((w) => w.number).sort((a, b) => a - b),
    reached: started.reduce((max, w) => Math.max(max, w.number), 0),
  };
}

/** Whether a wave is over capacity, for the warning on the schedule. */
export function isOverCapacity(wave: Pick<WaveState, "teamCount" | "capacity">) {
  return wave.teamCount > wave.capacity;
}

/**
 * How the floor panel reads when more than one wave is running.
 *
 * With several on the floor the board cannot show them all at once and stay
 * legible from across a gym, so it shows one at a time and turns the page on a
 * timer — the same idea as the bracket rotation, at a shorter interval.
 */
export const FLOOR_ROTATE_SECONDS = 15;

export function floorRotation(runningNumbers: number[], tick: number) {
  if (runningNumbers.length === 0) return null;
  return runningNumbers[tick % runningNumbers.length];
}

/**
 * The label for a wave's scheduled window, from its own start and length
 * rather than from an assumption that every wave is the same size.
 */
export function waveWindowLabel(startTime: string, durationMinutes: number) {
  const [h, m] = startTime.split(":");
  const start = (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
  const end = ((start + durationMinutes) % 1440 + 1440) % 1440;
  const fmt = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(end) };
}

// ── The wave clock, kept honest ──────────────────────────────────────────────
// A wave starts when the operator starts it, and it ends by its own clock:
// when its time runs out it comes off the floor by itself, a transition gap
// passes for preparing the next one, and then the next wave with teams steps
// on — automatically, chained by order, with no operator present.

/** Minutes between one wave coming off the floor and the next stepping on. */
export const WAVE_TRANSITION_MINUTES = 5;

export type WaveClockRow = {
  id: string;
  number: number;
  status: WaveStatus;
  endsAt: Date | null;
  durationMinutes: number;
  teamCount: number;
};

export type WaveClockSweep = {
  /** Running waves whose time is up — to be marked complete. */
  finish: string[];
  /** The next wave with teams, when its transition gap has passed. */
  start: { id: string; startedAt: Date; endsAt: Date } | null;
};

/**
 * Which wave transitions are DUE at `now`.
 *
 * Pure and dependency-free so the rules can be tested directly.
 *
 *   FINISH   every running wave whose endsAt has passed — a wave ends by its
 *            own clock, counted from the moment it actually started, however
 *            late its competitors trickled onto the floor.
 *   START    once the floor is empty and the transition gap has passed, the
 *            lowest-numbered pending wave with teams steps on. Only a chain
 *            already in motion rolls forward: the very first start stays in
 *            the operator's hands.
 */
export function waveClockSweep(rows: WaveClockRow[], now: Date): WaveClockSweep {
  const finish = rows
    .filter((row) => row.status === "running" && row.endsAt !== null && row.endsAt <= now)
    .map((row) => row.id);

  const stillRunning = rows.some(
    (row) => row.status === "running" && !finish.includes(row.id)
  );

  let start: WaveClockSweep["start"] = null;
  if (!stillRunning) {
    // The floor's most recent moment of work: when the last wave came off it.
    const lastOffFloor = rows
      .filter((row) => row.status === "complete" || finish.includes(row.id))
      .reduce((latest, row) => Math.max(latest, row.endsAt?.getTime() ?? 0), 0);

    if (lastOffFloor > 0 && now.getTime() >= lastOffFloor + WAVE_TRANSITION_MINUTES * 60_000) {
      const next = rows
        .filter((row) => row.status === "pending" && row.teamCount > 0)
        .sort((a, b) => a.number - b.number)[0];
      if (next) {
        const startedAt = now;
        const endsAt = new Date(now.getTime() + next.durationMinutes * 60_000);
        start = { id: next.id, startedAt, endsAt };
      }
    }
  }

  return { finish, start };
}
