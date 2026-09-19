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
  /** When START was pressed. The whole zone rotation is worked out from it. */
  startedAt: string | null;
  /** Where the wave is on the floor right now (src/lib/floor.ts). */
  floor: {
    phase: "pending" | "work" | "break" | "done";
    /** 1-based zone number the wave is working in, or has just left. */
    zoneNumber: number | null;
    /** Time left in the current zone's work or changeover. */
    phaseRemainingMs: number | null;
  };
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
// A wave starts when the supervisor presses START, moves through the zones by
// itself (src/lib/floor.ts), and ends by its own clock: when its time runs out
// it comes off the floor. The NEXT wave is the supervisor's to start — waves
// overlap on the floor one zone apart, so there is no single "next" to chain.

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
};

/**
 * Which waves are DUE to come off the floor at `now`: every running wave
 * whose endsAt has passed, counted from the moment it actually started.
 * Nothing is ever started here — START is the supervisor's.
 *
 * Pure and dependency-free so the rule can be tested directly.
 */
export function waveClockSweep(rows: WaveClockRow[], now: Date): WaveClockSweep {
  return {
    finish: rows
      .filter((row) => row.status === "running" && row.endsAt !== null && row.endsAt <= now)
      .map((row) => row.id),
  };
}
