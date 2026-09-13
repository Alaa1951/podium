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
    teamCount: 9,
    scoredCount: 0,
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
    });
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
// A wave whose time has run out comes off the floor by itself, and the next
// wave with teams steps on — chained by the clock, with no operator present.

import { waveClockSweep, type WaveClockRow } from "@/lib/waves";

const SWEEP_NOW = new Date("2026-09-12T09:00:00Z");
const sweepMinutes = (m: number) => new Date(SWEEP_NOW.getTime() + m * 60_000);

function clockRow(overrides: Partial<WaveClockRow>): WaveClockRow {
  return {
    id: "w",
    number: 1,
    status: "pending",
    endsAt: null,
    durationMinutes: 20,
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
    // The transition gap holds the next wave back for five minutes.
    expect(sweep.start).toBeNull();
  });

  it("leaves a running wave that still has time", () => {
    const sweep = waveClockSweep(
      [clockRow({ id: "a", number: 1, status: "running", endsAt: sweepMinutes(10) })],
      SWEEP_NOW
    );
    expect(sweep.finish).toEqual([]);
    expect(sweep.start).toBeNull();
  });

  it("holds the next wave through the transition gap, then starts it", () => {
    const rows = [
      clockRow({ id: "a", number: 1, status: "running", endsAt: sweepMinutes(-6), durationMinutes: 20 }),
      clockRow({ id: "b", number: 2, status: "pending", durationMinutes: 15 }),
    ];

    // One minute after the wave came off: it is finished at once, but the
    // five-minute transition gap still holds the next wave back.
    const during = waveClockSweep(rows, sweepMinutes(-5));
    expect(during.finish).toEqual(["a"]);
    expect(during.start).toBeNull();

    // Five minutes after it came off: the next wave steps on, clocked from NOW.
    const after = waveClockSweep(rows, sweepMinutes(0));
    expect(after.finish).toEqual(["a"]);
    expect(after.start).toEqual({
      id: "b",
      startedAt: SWEEP_NOW,
      endsAt: sweepMinutes(15),
    });
  });

  it("never starts an empty wave — it skips to the next one with teams", () => {
    const sweep = waveClockSweep(
      [
        clockRow({ id: "a", number: 1, status: "complete", endsAt: sweepMinutes(-6) }),
        clockRow({ id: "b", number: 2, status: "pending", teamCount: 0 }),
        clockRow({ id: "c", number: 3, status: "pending", teamCount: 4, durationMinutes: 10 }),
      ],
      sweepMinutes(0)
    );
    expect(sweep.finish).toEqual([]);
    expect(sweep.start?.id).toBe("c");
    expect(sweep.start?.endsAt).toEqual(sweepMinutes(10));
  });

  it("does not start a follower while another wave is still legitimately running", () => {
    const sweep = waveClockSweep(
      [
        clockRow({ id: "a", number: 1, status: "running", endsAt: sweepMinutes(-1) }),
        clockRow({ id: "b", number: 2, status: "running", endsAt: sweepMinutes(9) }),
        clockRow({ id: "c", number: 3, status: "pending", durationMinutes: 10 }),
      ],
      SWEEP_NOW
    );
    expect(sweep.finish).toEqual(["a"]);
    expect(sweep.start).toBeNull();
  });

  it("never auto-starts the first wave — that stays with the operator", () => {
    // A scheduled event whose waves were never started: nothing completed, so
    // nothing rolls forward no matter how far past their times it is.
    const sweep = waveClockSweep(
      [
        clockRow({ id: "a", number: 1, status: "pending" }),
        clockRow({ id: "b", number: 2, status: "pending" }),
      ],
      SWEEP_NOW
    );
    expect(sweep.finish).toEqual([]);
    expect(sweep.start).toBeNull();
  });
});
