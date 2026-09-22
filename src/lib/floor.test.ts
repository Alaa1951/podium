/**
 * The floor's arithmetic: 15 minutes of work per zone, 5 of changeover, no
 * break after the last zone, and waves one zone-slot apart.
 */
import { describe, expect, it } from "vitest";

import {
  hasReachedZone,
  lowestFreeStation,
  stationSlots,
  remainingClock,
  waveInZone,
  waveLengthMinutes,
  wavePosition,
  zoneOneFreeAt,
  zoneWindows,
  type FloorTiming,
} from "@/lib/floor";

const FOUR: FloorTiming = { workMinutes: 15, breakMinutes: 5, zoneCount: 4 };
const start = new Date("2026-10-03T08:00:00Z");
const at = (minutes: number, seconds = 0) => new Date(start.getTime() + minutes * 60_000 + seconds * 1000);

describe("wave length", () => {
  it("is 75 minutes for four zones of 15 + 5", () => {
    expect(waveLengthMinutes(FOUR)).toBe(75);
  });

  it("follows the number of zones", () => {
    expect(waveLengthMinutes({ ...FOUR, zoneCount: 3 })).toBe(55);
    expect(waveLengthMinutes({ ...FOUR, zoneCount: 5 })).toBe(95);
    expect(waveLengthMinutes({ ...FOUR, zoneCount: 1 })).toBe(15);
    expect(waveLengthMinutes({ ...FOUR, zoneCount: 0 })).toBe(0);
  });
});

describe("zone windows", () => {
  it("lays four zones out at 0-15 / 20-35 / 40-55 / 60-75", () => {
    const windows = zoneWindows(FOUR).map((w) => [w.workStartMs / 60_000, w.workEndMs / 60_000, w.breakEndMs / 60_000]);
    expect(windows).toEqual([
      [0, 15, 20],
      [20, 35, 40],
      [40, 55, 60],
      [60, 75, 75],
    ]);
  });
});

describe("where a wave is", () => {
  const wave = { startedAt: start };

  it("is pending before it starts", () => {
    expect(wavePosition({ startedAt: null }, FOUR, at(0)).phase).toBe("pending");
  });

  it("works zone 1, breaks, then works zone 2", () => {
    expect(wavePosition(wave, FOUR, at(0))).toMatchObject({ phase: "work", zoneIndex: 0 });
    expect(wavePosition(wave, FOUR, at(14, 59))).toMatchObject({ phase: "work", zoneIndex: 0 });
    expect(wavePosition(wave, FOUR, at(15))).toMatchObject({ phase: "break", zoneIndex: 0 });
    expect(wavePosition(wave, FOUR, at(20))).toMatchObject({ phase: "work", zoneIndex: 1 });
    expect(wavePosition(wave, FOUR, at(62))).toMatchObject({ phase: "work", zoneIndex: 3 });
  });

  it("counts the whole wave clock down to the finish", () => {
    expect(wavePosition(wave, FOUR, at(65)).waveRemainingMs).toBe(10 * 60_000);
    expect(wavePosition(wave, FOUR, at(70)).waveRemainingMs).toBe(5 * 60_000);
  });

  it("is done at 75 minutes, or when ended early", () => {
    expect(wavePosition(wave, FOUR, at(75)).phase).toBe("done");
    expect(wavePosition({ startedAt: start, completed: true }, FOUR, at(30)).phase).toBe("done");
  });

  it("knows which zones a wave has reached", () => {
    expect(hasReachedZone(wave, 0, FOUR, at(0))).toBe(true);
    expect(hasReachedZone(wave, 1, FOUR, at(19, 59))).toBe(false);
    expect(hasReachedZone(wave, 1, FOUR, at(20))).toBe(true);
    expect(hasReachedZone({ startedAt: null }, 0, FOUR, at(0))).toBe(false);
  });
});

describe("the start guard", () => {
  it("keeps Zone 1 busy for the first wave's work and changeover", () => {
    expect(zoneOneFreeAt([{ startedAt: start }], FOUR, at(10))).toEqual(at(20));
    expect(zoneOneFreeAt([{ startedAt: start }], FOUR, at(20))).toBeNull();
  });

  it("is free when nothing is on the floor", () => {
    expect(zoneOneFreeAt([], FOUR, at(0))).toBeNull();
  });

  it("so waves started when allowed never share a zone", () => {
    const waves = [{ startedAt: start, n: 1 }, { startedAt: at(20), n: 2 }, { startedAt: at(40), n: 3 }];
    for (let minute = 0; minute < 120; minute++) {
      const zones = waves
        .map((w) => wavePosition(w, FOUR, at(minute)))
        .filter((p) => p.phase === "work" || p.phase === "break")
        .map((p) => p.zoneIndex);
      expect(new Set(zones).size).toBe(zones.length);
    }
  });
});

describe("which wave is in a zone", () => {
  const waves = [{ startedAt: start, n: 1 }, { startedAt: at(20), n: 2 }];

  it("finds the wave working there, or still in the break after it", () => {
    expect(waveInZone(waves, 0, FOUR, at(25))?.wave.n).toBe(2);
    expect(waveInZone(waves, 1, FOUR, at(25))?.wave.n).toBe(1);
    expect(waveInZone(waves, 1, FOUR, at(36))).toMatchObject({ phase: "break" });
    expect(waveInZone(waves, 3, FOUR, at(25))).toBeNull();
  });
});

describe("stations", () => {
  it("hands out the lowest free station, up to nine", () => {
    expect(lowestFreeStation([])).toBe(1);
    expect(lowestFreeStation([1, 2, 4])).toBe(3);
    expect(lowestFreeStation([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
    expect(lowestFreeStation([null, 1])).toBe(2);
  });

  it("never goes past nine, whatever the capacity says", () => {
    expect(lowestFreeStation([1, 2, 3, 4, 5, 6, 7, 8, 9], 12)).toBeNull();
    expect(lowestFreeStation([1, 2], 2)).toBeNull();
  });

  // A wave set to seven teams should not draw nine rigs with two of them
  // permanently empty — the screens read this, not MAX_STATIONS.
  it("draws as many slots as the wave's capacity", () => {
    expect(stationSlots(7, [])).toBe(7);
    expect(stationSlots(7, [1, 2, 3])).toBe(7);
    expect(stationSlots(1, [])).toBe(1);
  });

  // THE ONE THAT MATTERS. Lowering the capacity under a wave whose teams are
  // already placed must not hide the ones standing off the end: a team nobody
  // can see is a team nobody moves, and it is found on the morning.
  it("never hides a team standing past the capacity", () => {
    expect(stationSlots(7, [1, 2, 9])).toBe(9);
    expect(stationSlots(3, [5])).toBe(5);
    expect(stationSlots(7, [null, 8, null])).toBe(8);
  });

  it("still stops at nine, and never returns nothing to draw", () => {
    expect(stationSlots(12, [])).toBe(9);
    expect(stationSlots(0, [])).toBe(1);
    expect(stationSlots(-3, [null])).toBe(1);
  });
});

describe("the finisher record", () => {
  it("splits remaining time into minutes and seconds", () => {
    expect(remainingClock(5 * 60_000 + 7_900)).toEqual({ minutes: 5, seconds: 7 });
    expect(remainingClock(-100)).toEqual({ minutes: 0, seconds: 0 });
  });
});
