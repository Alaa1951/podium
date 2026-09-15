/**
 * The scoring engine is the one place where being wrong is not recoverable —
 * a bad total goes on a wall and into a result. So the Series 1 table is
 * reproduced here number for number, including the worked example that was
 * checked against BFT's own published team page.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ZONES,
  factorLabel,
  filledCount,
  groupInputs,
  inputPoints,
  isComplete,
  isCounted,
  totalPoints,
  validateEntries,
  zoneBreakdown,
  zoneFormula,
  zonePoints,
  type ZoneDef,
} from "@/lib/zones";

/** The default definition, with ids, exactly as a seeded series would hold it. */
const ZONES: ZoneDef[] = DEFAULT_ZONES.map((zone) => ({
  id: `z${zone.number}`,
  number: zone.number,
  name: zone.name,
  inputs: zone.inputs.map((input) => ({ ...input, id: `z${zone.number}i${input.position}` })),
}));

const [DEADLIFT, BENCH] = ["z1i1", "z1i2"];
const METRES = "z2i1";
const [KETTLEBELL, DUMBBELL] = ["z3i1", "z3i2"];
const [MINUTES, SECONDS] = ["z4i1", "z4i2"];

describe("one input's points", () => {
  const find = (id: string) => ZONES.flatMap((z) => z.inputs).find((i) => i.id === id)!;

  it("multiplies reps by ten", () => {
    expect(inputPoints(find(DEADLIFT), 259)).toBe(2590);
  });

  it("counts reps and rounds; metres and time are typed, not tapped", () => {
    expect(isCounted(find(DEADLIFT))).toBe(true);
    expect(isCounted(find(DUMBBELL))).toBe(true);
    expect(isCounted(find(METRES))).toBe(false);
    expect(isCounted(find(MINUTES))).toBe(false);
  });

  it("divides metres by a hundred", () => {
    expect(inputPoints(find(METRES), 3221)).toBe(32.21);
  });

  it("divides seconds by ten", () => {
    expect(inputPoints(find(SECONDS), 41)).toBe(4.1);
  });

  it("treats a missing value as no contribution, not as zero entered", () => {
    expect(inputPoints(find(DEADLIFT), null)).toBe(0);
    expect(inputPoints(find(DEADLIFT), undefined)).toBe(0);
  });
});

describe("the Series 1 worked example", () => {
  // 259 deadlift + 227 bench, 3,221 m, 14 kettlebell + 12 dumbbell, 02:41 left.
  const values = {
    [DEADLIFT]: 259,
    [BENCH]: 227,
    [METRES]: 3221,
    [KETTLEBELL]: 14,
    [DUMBBELL]: 12,
    [MINUTES]: 2,
    [SECONDS]: 41,
  };

  it("scores each zone the way the table does", () => {
    expect(zonePoints(ZONES[0], values)).toBe(4860); // 486 reps × 10
    expect(zonePoints(ZONES[1], values)).toBe(32.21); // 3,221 ÷ 100
    expect(zonePoints(ZONES[2], values)).toBe(260); // 26 rounds × 10
    expect(zonePoints(ZONES[3], values)).toBe(24.1); // (2 × 10) + (41 ÷ 10)
  });

  it("totals to the published figure", () => {
    expect(totalPoints(ZONES, values)).toBe(5176.31);
  });

  it("never drifts by a hundredth, however the decimals fall", () => {
    // 0.1 + 0.2 arithmetic is why totals are counted in whole hundredths.
    const awkward = { [METRES]: 10, [SECONDS]: 1, [MINUTES]: 0 };
    expect(totalPoints(ZONES, awkward)).toBe(0.2);
  });

  it("reproduces BFT's own team page: 4510 + 35.49 + 290 + 43", () => {
    // Checked against the published team detail for a real Series 1 team.
    const team = {
      [DEADLIFT]: 240,
      [BENCH]: 211,
      [METRES]: 3549,
      [KETTLEBELL]: 15,
      [DUMBBELL]: 14,
      [MINUTES]: 4,
      [SECONDS]: 30,
    };
    const zones = zoneBreakdown(ZONES, team).map((z) => z.points);
    expect(zones).toEqual([4510, 35.49, 290, 43]);
    expect(totalPoints(ZONES, team)).toBe(4878.49);
  });
});

describe("the franchise manual's worked example", () => {
  /**
   * Straight off page 10 of the PODIUM Series #1 Leaderboard Manual, the
   * document BFT gives its studios. If this figure ever moves, our scoring has
   * diverged from the one every other region is using — which is the one
   * failure in this file that cannot be argued about.
   *
   *   DL 31 + BP 29 = 60 reps × 10          →   600.00
   *   ROWER 2,568 m ÷ 100                   →    25.68
   *   KB 19 + DB 21 = 40 rounds × 10        →   400.00
   *   REMAINING 00:19 → (0 × 10) + (19 ÷ 10) →     1.90
   *                                            ─────────
   *                                             1,027.58
   */
  const manual = {
    [DEADLIFT]: 31,
    [BENCH]: 29,
    [METRES]: 2568,
    [KETTLEBELL]: 19,
    [DUMBBELL]: 21,
    [MINUTES]: 0,
    [SECONDS]: 19,
  };

  it("scores each zone exactly as the manual prints it", () => {
    expect(zoneBreakdown(ZONES, manual).map((z) => z.points)).toEqual([600, 25.68, 400, 1.9]);
  });

  it("totals to 1027.58", () => {
    expect(totalPoints(ZONES, manual)).toBe(1027.58);
  });
});

describe("groupInputs — how the fields are drawn", () => {
  it("pairs the finisher's minutes and seconds into one clock", () => {
    const groups = groupInputs(ZONES[3]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("clock");
  });

  it("leaves every other movement standing on its own", () => {
    expect(groupInputs(ZONES[0]).map((g) => g.kind)).toEqual(["single", "single"]);
    expect(groupInputs(ZONES[1]).map((g) => g.kind)).toEqual(["single"]);
  });

  it("does not pair a seconds field that is not the one straight after", () => {
    // Adjacency is the rule. A stray seconds field further down the zone is
    // its own movement and must keep its own box.
    const zone: ZoneDef = {
      id: "z",
      number: 1,
      name: "Odd",
      inputs: [
        { id: "m", position: 1, label: "Minutes", unit: "min", multiplyBy: 10, divideBy: 1, maxValue: 15, inputMode: "minutes" },
        { id: "n", position: 2, label: "Reps", unit: "reps", multiplyBy: 1, divideBy: 1, maxValue: null, inputMode: "number" },
        { id: "s", position: 3, label: "Seconds", unit: "sec", multiplyBy: 1, divideBy: 10, maxValue: 59, inputMode: "seconds" },
      ],
    };
    expect(groupInputs(zone).map((g) => g.kind)).toEqual(["single", "single", "single"]);
  });

  it("never drops or duplicates a movement, whatever the modes", () => {
    for (const zone of ZONES) {
      const drawn = groupInputs(zone).flatMap((g) =>
        g.kind === "clock" ? [g.minutes.id, g.seconds.id] : [g.input.id]
      );
      expect(drawn).toEqual(zone.inputs.map((i) => i.id));
    }
  });
});

describe("a differently shaped series", () => {
  // The whole point: a series is not required to look like Series 1.
  const twoZones: ZoneDef[] = [
    {
      id: "a",
      number: 1,
      name: "Sled",
      inputs: [
        { id: "a1", position: 1, label: "Metres", unit: "m", multiplyBy: 5, divideBy: 1, maxValue: null, inputMode: "number" },
      ],
    },
    {
      id: "b",
      number: 2,
      name: "Ski",
      inputs: [
        { id: "b1", position: 1, label: "Calories", unit: "cal", multiplyBy: 3, divideBy: 2, maxValue: null, inputMode: "number" },
      ],
    },
  ];

  it("scores movements this file has never heard of", () => {
    expect(totalPoints(twoZones, { a1: 20, b1: 7 })).toBe(110.5); // 100 + 10.5
  });

  it("has no opinion about there being four zones", () => {
    expect(zoneBreakdown(twoZones, { a1: 20, b1: 7 })).toHaveLength(2);
  });

  it("scores an empty definition as nothing rather than crashing", () => {
    expect(totalPoints([], { a1: 20 })).toBe(0);
  });
});

describe("completeness", () => {
  const partial = { [DEADLIFT]: 100, [BENCH]: 90, [METRES]: 2000 };

  it("is not complete while a movement is unrecorded", () => {
    expect(isComplete(ZONES, partial)).toBe(false);
  });

  it("counts what is filled, for the operator's progress line", () => {
    expect(filledCount(ZONES, partial)).toEqual({ filled: 3, total: 7 });
  });

  it("counts a recorded zero as recorded", () => {
    // A team that rowed nothing still recorded a result.
    const zeros = Object.fromEntries(
      ZONES.flatMap((z) => z.inputs).map((i) => [i.id, 0])
    );
    expect(isComplete(ZONES, zeros)).toBe(true);
  });
});

describe("validation", () => {
  it("accepts a clean sheet", () => {
    expect(validateEntries(ZONES, { [DEADLIFT]: 100, [SECONDS]: 59 })).toEqual([]);
  });

  it("rejects a negative", () => {
    expect(validateEntries(ZONES, { [DEADLIFT]: -1 })).toEqual([
      { inputId: DEADLIFT, code: "NEGATIVE" },
    ]);
  });

  it("rejects a fraction of a rep", () => {
    expect(validateEntries(ZONES, { [DEADLIFT]: 1.5 })).toEqual([
      { inputId: DEADLIFT, code: "NOT_AN_INTEGER" },
    ]);
  });

  it("takes its bounds from the definition, not from a rule written here", () => {
    expect(validateEntries(ZONES, { [SECONDS]: 60 })).toEqual([
      { inputId: SECONDS, code: "OVER_MAX" },
    ]);
    expect(validateEntries(ZONES, { [MINUTES]: 16 })).toEqual([
      { inputId: MINUTES, code: "OVER_MAX" },
    ]);
  });

  it("leaves an unbounded input unbounded", () => {
    expect(validateEntries(ZONES, { [DEADLIFT]: 99_999 })).toEqual([]);
  });

  it("says nothing about a field nobody filled in", () => {
    expect(validateEntries(ZONES, {})).toEqual([]);
  });
});

describe("how a formula reads on screen", () => {
  it("spells out a factor the way a person says it", () => {
    expect(factorLabel({ multiplyBy: 10, divideBy: 1 })).toBe("× 10");
    expect(factorLabel({ multiplyBy: 1, divideBy: 100 })).toBe("÷ 100");
    expect(factorLabel({ multiplyBy: 3, divideBy: 2 })).toBe("× 3 ÷ 2");
    expect(factorLabel({ multiplyBy: 1, divideBy: 1 })).toBe("× 1");
  });

  it("spells out a zone", () => {
    expect(zoneFormula(ZONES[3])).toBe("(minutes remaining × 10) + (seconds remaining ÷ 10)");
  });
});
