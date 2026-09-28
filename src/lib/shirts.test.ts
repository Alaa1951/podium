/**
 * The T-shirt order: one shirt per seat on an entered team, the size taken
 * from where it was most recently given, the waiting list kept apart.
 */
import { describe, expect, it } from "vitest";

import { resolveShirtSize, summariseShirts, type ShirtSeat } from "@/lib/shirts";

const seat = (extra: Partial<ShirtSeat>): ShirtSeat => ({
  teamNumber: 1,
  teamName: "Team",
  athlete: "Athlete",
  studio: "West Walk",
  category: "mixed",
  division: "open",
  waveNumber: 1,
  station: 1,
  waitlisted: false,
  size: "M",
  source: "seat",
  ...extra,
});

describe("which size a seat wears", () => {
  it("takes the seat's own size first", () => {
    expect(resolveShirtSize({ seat: "L", signup: "M", partner: "S", profile: "XS" })).toEqual({ size: "L", source: "seat" });
  });

  it("falls back to the sign-up, then what a partner typed, then the profile", () => {
    expect(resolveShirtSize({ seat: null, signup: "M", partner: "S", profile: "XS" })).toEqual({ size: "M", source: "signup" });
    expect(resolveShirtSize({ seat: null, signup: null, partner: "S", profile: "XS" })).toEqual({ size: "S", source: "partner" });
    expect(resolveShirtSize({ seat: null, signup: null, partner: null, profile: "XS" })).toEqual({ size: "XS", source: "profile" });
  });

  it("has none when nobody gave one", () => {
    expect(resolveShirtSize({ seat: null, signup: null, partner: null, profile: null })).toEqual({ size: null, source: null });
  });
});

describe("the order", () => {
  it("counts every seat by size", () => {
    const summary = summariseShirts([seat({ size: "M" }), seat({ size: "M" }), seat({ size: "XL" })]);
    expect(summary.field).toMatchObject({ M: 2, XL: 1, S: 0, total: 3 });
  });

  it("keeps the waiting list out of the order, in its own column", () => {
    const summary = summariseShirts([seat({ size: "L" }), seat({ size: "L", waitlisted: true })]);
    expect(summary.field).toMatchObject({ L: 1, total: 1 });
    expect(summary.waitlisted).toMatchObject({ L: 1, total: 1 });
  });

  it("lists the seats with no size instead of guessing one", () => {
    const summary = summariseShirts([seat({ size: null, source: null, athlete: "Sara", teamNumber: 7 })]);
    expect(summary.field.total).toBe(0);
    expect(summary.missing.map((row) => [row.teamNumber, row.athlete])).toEqual([[7, "Sara"]]);
  });

  it("splits the order by gym and by category and level", () => {
    const summary = summariseShirts([
      seat({ size: "S", studio: "West Walk" }),
      seat({ size: "S", studio: "The Pearl", category: "womens" }),
      seat({ size: "M", studio: null, category: "womens" }),
    ]);
    expect(summary.byStudio.map((row) => [row.studio, row.counts.total])).toEqual([
      ["—", 1],
      ["The Pearl", 1],
      ["West Walk", 1],
    ]);
    expect(summary.byGroup.map((row) => [row.category, row.division, row.counts.S, row.counts.M])).toEqual([
      ["mixed", "open", 1, 0],
      ["womens", "open", 1, 1],
    ]);
  });
});
