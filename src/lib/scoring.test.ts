/**
 * What survives in scoring.ts after the formulas moved out: brackets, the tie
 * rule, the outlier prompt, and the event-day clocks. A podium decided by a
 * rounding slip is not recoverable after the event, so the tie rule in
 * particular is pinned here. The formulas themselves are configuration now and
 * are tested in zones.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  addMinutes,
  BRACKETS,
  bracketAt,
  bracketIndex,
  clockFromMs,
  countdown,
  fmt,
  isOutlier,
  normalizeName,
  rankAll,
} from "@/lib/scoring";

describe("ranking", () => {
  it("sorts by total, highest first", () => {
    const ranked = rankAll([
      { id: "c", total: 10 },
      { id: "a", total: 30 },
      { id: "b", total: 20 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("shares a rank on a tie and skips the next (1, 2, 2, 4)", () => {
    const ranked = rankAll([
      { id: "a", total: 100 },
      { id: "b", total: 90 },
      { id: "c", total: 90 },
      { id: "d", total: 80 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it("treats totals within a hundredth as equal, so float noise is not a podium", () => {
    const ranked = rankAll([
      { id: "a", total: 4860.12 },
      { id: "b", total: 4860.121 },
    ]);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(1);
  });

  it("does not mutate the array it was given", () => {
    const rows = [{ id: "a", total: 1 }, { id: "b", total: 2 }];
    rankAll(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty bracket", () => {
    expect(rankAll([])).toEqual([]);
  });
});

describe("the outlier prompt", () => {
  const peers = [1000, 1010, 990, 1005];

  it("stays quiet for a total near the bracket mean", () => {
    expect(isOutlier(1002, peers)).toBe(false);
  });

  it("flags a total more than 40% away", () => {
    expect(isOutlier(10_000, peers)).toBe(true);
    expect(isOutlier(100, peers)).toBe(true);
  });

  it("says nothing when there is nothing to compare against", () => {
    expect(isOutlier(10_000, [])).toBe(false);
    expect(isOutlier(10_000, [1000])).toBe(false);
  });

  it("never flags an unscored team", () => {
    expect(isOutlier(0, peers)).toBe(false);
  });
});

describe("brackets", () => {
  it("is nine — three categories by three divisions", () => {
    expect(BRACKETS).toHaveLength(9);
  });

  it("round-trips an index", () => {
    for (let i = 0; i < 9; i++) {
      const bracket = bracketAt(i);
      expect(bracketIndex(bracket.category, bracket.division)).toBe(i);
    }
  });

  it("wraps an out-of-range index rather than returning undefined", () => {
    expect(bracketAt(9)).toEqual(BRACKETS[0]);
    expect(bracketAt(-1)).toEqual(BRACKETS[8]);
  });
});

describe("event-day timing", () => {
  it("advances a wave start by the wave length", () => {
    expect(addMinutes("09:00", 40)).toBe("09:40");
  });

  it("wraps around midnight", () => {
    expect(addMinutes("23:50", 20)).toBe("00:10");
    expect(addMinutes("00:10", -20)).toBe("23:50");
  });

  it("counts a clock down and never below zero", () => {
    expect(clockFromMs(125_000)).toBe("02:05");
    expect(clockFromMs(-5000)).toBe("00:00");
  });

  it("splits a countdown into padded parts", () => {
    expect(countdown(90_061_000)).toEqual({
      days: "01",
      hours: "01",
      minutes: "01",
      seconds: "01",
    });
  });
});

describe("name matching", () => {
  it("ignores case, spacing and punctuation", () => {
    expect(normalizeName("  Omar   HADDAD! ")).toBe("omar haddad");
    expect(normalizeName("O'Brien-Smith")).toBe("obriensmith");
  });

  it("matches a studio's registration to a self-created account", () => {
    expect(normalizeName("Sara Nasser")).toBe(normalizeName("sara  nasser"));
  });

  it("survives a null-ish value", () => {
    expect(normalizeName("")).toBe("");
  });
});

describe("number formatting", () => {
  it("groups thousands and fixes the decimals the board expects", () => {
    expect(fmt(5176.31, 2)).toBe("5,176.31");
    expect(fmt(4860, 0)).toBe("4,860");
    expect(fmt(32.2, 2)).toBe("32.20");
  });
});
