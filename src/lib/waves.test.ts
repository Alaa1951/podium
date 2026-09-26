/**
 * Waves are rows with their own clocks, and more than one can be on the floor
 * at once. That is the whole reason these helpers exist, so the concurrent
 * cases are the ones pinned hardest here.
 */
import { describe, expect, it } from "vitest";

import {
  FLOOR_ROTATE_SECONDS,
  floorRotation,
  isOverCapacity,
  summariseWaves,
  waveWindowLabel,
  type WaveState,
} from "@/lib/waves";

function wave(number: number, status: WaveState["status"], extra: Partial<WaveState> = {}): WaveState {
  return {
    id: `w${number}`,
    number,
    status,
    capacity: 9,
    durationMinutes: 20,
    startTime: "09:00",
    remainingMs: status === "running" ? 600_000 : null,
    endsAt: null,
    stoppedRemainingMs: null,
    teamCount: 9,
    scoredCount: 0,
    startedAt: null,
    floor: { phase: status === "running" ? "work" : status === "complete" ? "done" : "pending", zoneNumber: null, phaseRemainingMs: null },
    ...extra,
  };
}

describe("summariseWaves", () => {
  it("counts each state and lists what is on the floor, in order", () => {
    const summary = summariseWaves([
      wave(1, "complete"),
      wave(2, "running"),
      wave(4, "running"),
      wave(3, "pending"),
    ]);

    expect(summary).toEqual({
      total: 4,
      pending: 1,
      running: 2,
      complete: 1,
      runningNumbers: [2, 4],
      reached: 4,
      lastNumber: 4,
    });
  });

  // 🔴 THE ONE THE BOARD GOT WRONG. A day whose waves are numbered 3 to 16 —
  // because two were deleted — has FOURTEEN waves and a last number of
  // SIXTEEN. The wall screen put the wave in focus over the count and read
  // "WAVE 16 / 14", which is not a thing that can be true.
  it("tells the highest wave number apart from how many waves there are", () => {
    const numbered = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((n) =>
      wave(n, "complete")
    );
    const summary = summariseWaves(numbered);

    expect(summary.total).toBe(14);
    expect(summary.lastNumber).toBe(16);
    // And the thing the header actually needs: the wave in focus can never be
    // past the end of the line.
    expect(summary.reached).toBeLessThanOrEqual(summary.lastNumber);
  });

  it("counts a wave nobody has started into the line, but not into what was reached", () => {
    const summary = summariseWaves([wave(1, "complete"), wave(9, "pending")]);
    expect(summary.lastNumber).toBe(9);
    expect(summary.reached).toBe(1);
  });

  it("answers zero for a day with no waves at all, rather than -Infinity", () => {
    expect(summariseWaves([]).lastNumber).toBe(0);
  });

  it("reads an empty schedule as nothing rather than as wave 1", () => {
    expect(summariseWaves([])).toMatchObject({ total: 0, reached: 0, runningNumbers: [] });
  });

  it("counts a wave as reached the moment it starts, not when it finishes", () => {
    // The board's "waves 1–N so far" must include the wave on the floor —
    // otherwise a team scores and disappears until its wave is closed.
    expect(summariseWaves([wave(1, "complete"), wave(2, "running")]).reached).toBe(2);
  });

  it("does not count a pending wave as reached", () => {
    expect(summariseWaves([wave(1, "complete"), wave(2, "pending")]).reached).toBe(1);
  });
});

describe("floorRotation", () => {
  it("holds still on a single wave, whatever the tick", () => {
    expect(floorRotation([3], 0)).toBe(3);
    expect(floorRotation([3], 97)).toBe(3);
  });

  it("turns the page through every running wave and comes back round", () => {
    const numbers = [2, 4, 5];
    expect([0, 1, 2, 3].map((tick) => floorRotation(numbers, tick))).toEqual([2, 4, 5, 2]);
  });

  it("shows nothing when nothing is on the floor", () => {
    expect(floorRotation([], 4)).toBeNull();
  });

  it("turns every fifteen seconds, the interval BFT MENA asked for", () => {
    expect(FLOOR_ROTATE_SECONDS).toBe(15);
  });
});

describe("isOverCapacity", () => {
  it("is a warning at one over, not at the limit", () => {
    expect(isOverCapacity({ teamCount: 9, capacity: 9 })).toBe(false);
    expect(isOverCapacity({ teamCount: 10, capacity: 9 })).toBe(true);
  });
});

describe("waveWindowLabel", () => {
  it("reads a wave's window from its own start and its own length", () => {
    expect(waveWindowLabel("09:00", 20)).toEqual({ start: "09:00", end: "09:20" });
    expect(waveWindowLabel("09:50", 15)).toEqual({ start: "09:50", end: "10:05" });
  });

  it("wraps past midnight rather than printing an impossible hour", () => {
    expect(waveWindowLabel("23:50", 20)).toEqual({ start: "23:50", end: "00:10" });
  });
});

// ── The wave clock sweep ─────────────────────────────────────────────────────
// A wave whose time has run out comes off the floor by itself. Starting the
// next one is the supervisor's: waves overlap one zone apart, so the sweep
// never chains a start.

import { nextWaveStart, waveClockSweep, type WaveClockRow } from "@/lib/waves";

const SWEEP_NOW = new Date("2026-09-12T09:00:00Z");
const sweepMinutes = (m: number) => new Date(SWEEP_NOW.getTime() + m * 60_000);

function clockRow(overrides: Partial<WaveClockRow>): WaveClockRow {
  return {
    id: "w",
    number: 1,
    status: "pending",
    endsAt: null,
    durationMinutes: 75,
    teamCount: 5,
    ...overrides,
  };
}

describe("waveClockSweep", () => {
  it("finishes a running wave whose time has run out", () => {
    const sweep = waveClockSweep(
      [clockRow({ id: "a", number: 1, status: "running", endsAt: sweepMinutes(-1) })],
      SWEEP_NOW
    );
    expect(sweep.finish).toEqual(["a"]);
  });

  it("leaves a running wave that still has time", () => {
    const sweep = waveClockSweep(
      [clockRow({ id: "a", number: 1, status: "running", endsAt: sweepMinutes(10) })],
      SWEEP_NOW
    );
    expect(sweep.finish).toEqual([]);
  });

  it("finishes only the expired one of several waves on the floor", () => {
    const sweep = waveClockSweep(
      [
        clockRow({ id: "a", number: 1, status: "running", endsAt: sweepMinutes(-1) }),
        clockRow({ id: "b", number: 2, status: "running", endsAt: sweepMinutes(19) }),
        clockRow({ id: "c", number: 3, status: "pending" }),
      ],
      SWEEP_NOW
    );
    expect(sweep.finish).toEqual(["a"]);
  });

  it("never starts anything — not even long after the last wave came off", () => {
    const sweep = waveClockSweep(
      [
        clockRow({ id: "a", number: 1, status: "complete", endsAt: sweepMinutes(-60) }),
        clockRow({ id: "b", number: 2, status: "pending" }),
      ],
      SWEEP_NOW
    );
    expect(sweep).toEqual({ finish: [] });
  });
});

describe("the wave the floor is waiting for", () => {
  const day = new Date("2026-09-26T00:00:00+03:00");
  const row = (number: number, status: "pending" | "running" | "complete", startTime: string) => ({ number, status, startTime });

  it("is the lowest pending wave, counted to its Qatar start", () => {
    const now = new Date("2026-09-26T14:30:00+03:00").getTime();
    const next = nextWaveStart([row(1, "complete", "14:00"), row(3, "pending", "14:50"), row(2, "pending", "14:40")], day, now);
    expect(next).toEqual({ number: 2, startsInMs: 10 * 60_000 });
  });

  it("goes negative once the start is due, and is null when every wave has run", () => {
    const now = new Date("2026-09-26T15:00:00+03:00").getTime();
    expect(nextWaveStart([row(2, "pending", "14:40")], day, now)?.startsInMs).toBe(-20 * 60_000);
    expect(nextWaveStart([row(1, "complete", "14:00")], day, now)).toBeNull();
  });
});
