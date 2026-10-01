/** What stands between a team and its wave: waiver, entrance, warm-up — for every athlete, never dropped. */
import { describe, expect, it } from "vitest";

import { entranceGaps, readyFor, startBlockers, warmupGaps, type TeamCheck } from "@/lib/readiness";

const athlete = (id: string, over: Partial<TeamCheck["athletes"][number]> = {}) => ({ id, name: `Athlete ${id}`, waiver: "signed" as const, arrived: true, ...over });
const team = (over: Partial<TeamCheck> = {}): TeamCheck => ({
  id: "t1", number: 1, name: "ONE", inField: true, waveId: "w1", readyForWaveId: "w1", athletes: [athlete("a"), athlete("b")], ...over,
});

describe("entrance check-in", () => {
  it("names each athlete whose waiver is missing, and why", () => {
    expect(entranceGaps([athlete("a", { waiver: "pending" }), athlete("b"), athlete("c", { waiver: "no_account" }), athlete("d", { waiver: "resign" })]))
      .toEqual([{ id: "a", name: "Athlete a", gaps: ["waiver"] }, { id: "c", name: "Athlete c", gaps: ["account"] }, { id: "d", name: "Athlete d", gaps: ["waiver_resign"] }]);
    expect(entranceGaps([athlete("a", { waiver: "not_required" })])).toEqual([]);
  });
});

describe("warm-up check-in", () => {
  it("needs a wave, and every athlete signed and at the venue", () => {
    expect(warmupGaps(team({ waveId: null, athletes: [athlete("a", { arrived: false }), athlete("b", { waiver: "resign" })] }))).toEqual({
      team: { id: "t1", number: 1, name: "ONE" },
      gaps: ["no_wave"],
      athletes: [{ id: "a", name: "Athlete a", gaps: ["entrance"] }, { id: "b", name: "Athlete b", gaps: ["waiver_resign"] }],
    });
  });

  it("a withdrawn or waiting team, or one with nobody on it, is refused as such", () => {
    expect(warmupGaps(team({ inField: false, athletes: [] })).gaps).toEqual(["registration", "no_athletes"]);
  });
});

describe("Start Wave", () => {
  it("lists every team with a gap, by team and athlete — and only those", () => {
    const blockers = startBlockers([
      team(),
      team({ id: "t2", number: 2, name: "TWO", readyForWaveId: null }),
      team({ id: "t3", number: 3, name: "THREE", athletes: [athlete("c", { waiver: "pending", arrived: false }), athlete("d")] }),
    ], "w1");
    expect(blockers).toEqual([
      { team: { id: "t2", number: 2, name: "TWO" }, gaps: ["warmup"], athletes: [] },
      { team: { id: "t3", number: 3, name: "THREE" }, gaps: [], athletes: [{ id: "c", name: "Athlete c", gaps: ["waiver", "entrance"] }] },
    ]);
  });

  it("readiness given for another wave does not count after a move", () => {
    const moved = team({ waveId: "w2", readyForWaveId: "w1" });
    expect(readyFor(moved)).toBe(false);
    expect(startBlockers([moved], "w2")[0].gaps).toEqual(["warmup"]);
  });

  it("a fully ready wave has no blockers", () => {
    expect(startBlockers([team(), team({ id: "t2" })], "w1")).toEqual([]);
  });
});
