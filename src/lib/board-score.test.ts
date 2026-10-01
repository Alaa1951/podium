import { describe, expect, it } from "vitest";

import { boardScore } from "@/lib/board-score";

const zones = [
  { id: "z1", number: 1, name: "Strength", points: 4190 },
  { id: "z2", number: 2, name: "Conditioning", points: 23.6 },
  { id: "z3", number: 3, name: "Strength endurance", points: 250 },
  { id: "z4", number: 4, name: "Finisher", points: 13.5 },
];

describe("boardScore — what the wall shows of a team's score", () => {
  it("nothing submitted: not on the board, and no draft value leaves the server", () => {
    const score = boardScore(zones, []);
    expect(score.scored).toBe(false);
    expect(score.total).toBe(0);
    expect(score.zones.every((zone) => !zone.submitted && zone.points === 0)).toBe(true);
  });

  it("the first submitted zone puts the team on the board, with that zone's points only", () => {
    const score = boardScore(zones, ["z1"]);
    expect(score.scored).toBe(true);
    expect(score.total).toBe(4190);
    expect(score.zones.map((zone) => [zone.submitted, zone.points])).toEqual([[true, 4190], [false, 0], [false, 0], [false, 0]]);
  });

  it("the total climbs as zones arrive, in any order, and is exact once all four are in", () => {
    expect(boardScore(zones, ["z2", "z4"]).total).toBe(37.1);
    expect(boardScore(zones, ["z4", "z3", "z1", "z2"]).total).toBe(4477.1);
  });

  it("an unknown or stale zone id counts for nothing", () => {
    expect(boardScore(zones, ["gone"])).toMatchObject({ scored: false, total: 0 });
  });
});
