/**
 * The category schedule as the planner decides it: each category in its own
 * block at its own configured start, breaks after the LAST wave finishes,
 * protected teams exactly where staff put them, and a day that does not fit
 * reported rather than bent.
 */
import { describe, expect, it } from "vitest";

import type { Category, Division } from "@/generated/prisma/enums";
import {
  awardsWindows, clockLabel, lateForAwards, outsideItsBlock, privacyReview, scheduleTiming, touchesProtected, validateBlockConfig,
  type BlockConfig, type FixedWave, type PlanTeam,
} from "@/lib/category-schedule";
import { blockAt, planCategorySchedule } from "@/lib/category-schedule-plan";

/** Four zones of 15 minutes, 5-minute changeovers: a 75-minute wave, Zone 1 busy 20. */
const series = { waveIntervalMinutes: 20, zoneWorkMinutes: 15, zoneBreakMinutes: 5 };
const timing = scheduleTiming(series, 4, 7);

const config = (over: Partial<Record<Category, Partial<BlockConfig>>> = {}): BlockConfig[] => [
  { category: "Mens", position: 1, startTime: "09:00", breakMinutes: 60, ...over.Mens },
  { category: "Mixed", position: 2, startTime: "12:00", breakMinutes: 60, ...over.Mixed },
  { category: "Womens", position: 3, startTime: "15:00", breakMinutes: 90, ...over.Womens },
];

let serial = 0;
function field(counts: Partial<Record<Category, Partial<Record<Division, number>>>>): PlanTeam[] {
  const teams: PlanTeam[] = [];
  for (const [category, levels] of Object.entries(counts) as [Category, Partial<Record<Division, number>>][]) {
    for (const [division, count] of Object.entries(levels) as [Division, number][]) {
      for (let i = 0; i < count; i++) {
        serial += 1;
        teams.push({ id: `t${serial}`, number: serial, category, division });
      }
    }
  }
  return teams;
}

describe("timing — the floor's own rules", () => {
  it("a wave lasts every zone plus the changeovers; waves start one Zone-1 slot apart at least", () => {
    expect(timing).toEqual({ waveMinutes: 75, slotMinutes: 20, spacingMinutes: 20, capacity: 7 });
    // A longer interval between starts is kept; a shorter one cannot beat Zone 1.
    expect(scheduleTiming({ ...series, waveIntervalMinutes: 25 }, 4, 7).spacingMinutes).toBe(25);
    expect(scheduleTiming({ ...series, waveIntervalMinutes: 10 }, 4, 7).spacingMinutes).toBe(20);
    // One zone: no changeover after it, so Zone 1 is busy only for the work.
    expect(scheduleTiming(series, 1, 7)).toMatchObject({ waveMinutes: 15, slotMinutes: 15, spacingMinutes: 20 });
  });
});

describe("the configuration", () => {
  it("needs all three categories once, a running order 1–3, real times and breaks up to 12 hours", () => {
    expect(validateBlockConfig(config())).toMatchObject({ ok: true });
    expect(validateBlockConfig(config().slice(0, 2))).toEqual({ ok: false, error: "CATEGORY_SCHEDULE_INCOMPLETE" });
    expect(validateBlockConfig(config({ Mixed: { position: 1 } }))).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(validateBlockConfig(config({ Mixed: { startTime: "25:00" } }))).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(validateBlockConfig(config({ Mixed: { breakMinutes: -5 } }))).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(validateBlockConfig(config({ Mixed: { breakMinutes: 721 } }))).toEqual({ ok: false, error: "INVALID_INPUT" });
    // A break is not hard-coded: two hours is as valid as none.
    expect(validateBlockConfig(config({ Mixed: { breakMinutes: 120 }, Mens: { breakMinutes: 0 } }))).toMatchObject({ ok: true });
  });

  it("returns the blocks in running order", () => {
    const shuffled = config({ Womens: { position: 1, startTime: "08:00" }, Mens: { position: 2, startTime: "11:00" }, Mixed: { position: 3, startTime: "14:00" } });
    const result = validateBlockConfig(shuffled);
    expect(result.ok && result.blocks.map((block) => block.category)).toEqual(["Womens", "Mens", "Mixed"]);
  });
});

describe("scenario 1 — each category in its own block, in the configured order, at its configured start", () => {
  const teams = field({ Mens: { Rookie: 6, Open: 1, Pro: 1 }, Mixed: { Open: 5 }, Womens: { Rookie: 3 } });
  const plan = planCategorySchedule({ blocks: config(), timing, teams, fixed: [] });

  it("has no conflicts", () => expect(plan.conflicts).toEqual([]));

  it("starts each block at its own time, spacing its waves by the floor's slot", () => {
    expect(plan.waves.map((wave) => [wave.number, wave.startTime, wave.block, wave.seats.length])).toEqual([
      [1, "09:00", "Mens", 7],
      [2, "09:20", "Mens", 1],
      [3, "12:00", "Mixed", 5],
      [4, "15:00", "Womens", 3],
    ]);
  });

  it("scenario 5 — never puts a team into another category's block to fill a wave", () => {
    for (const wave of plan.waves) for (const seat of wave.seats) expect(seat.category).toBe(wave.block);
    // Men's second wave has one team and six empty stations; Mixed does not fill them.
    expect(plan.waves[1].seats.map((seat) => seat.station)).toEqual([1]);
  });

  it("keeps the level order inside a category: Rookie, then Open, then Pro; the next level fills the wave", () => {
    const men = plan.waves.filter((wave) => wave.block === "Mens").flatMap((wave) => wave.seats);
    const division = new Map(teams.map((team) => [team.id, team.division]));
    expect(men.map((seat) => division.get(seat.teamId))).toEqual(["Rookie", "Rookie", "Rookie", "Rookie", "Rookie", "Rookie", "Open", "Pro"]);
  });

  it("follows a different configured order just the same", () => {
    const other = planCategorySchedule({
      blocks: config({ Womens: { position: 1, startTime: "08:00" }, Mens: { position: 2, startTime: "10:45" }, Mixed: { position: 3, startTime: "13:30" } }),
      timing, teams, fixed: [],
    });
    expect(other.conflicts).toEqual([]);
    expect(other.waves.map((wave) => [wave.block, wave.startTime])).toEqual([
      ["Womens", "08:00"], ["Mens", "10:45"], ["Mens", "11:05"], ["Mixed", "13:30"],
    ]);
  });
});

describe("scenarios 2 and 3 — the break starts when the category's last wave FINISHES", () => {
  const teams = field({ Mens: { Rookie: 8 }, Mixed: { Open: 3 }, Womens: { Open: 3 } });

  it("a 60-minute break after Men: the last Men wave starts 09:20 and finishes 10:35, so Mixed may start at 11:35 — not 10:20", () => {
    const plan = planCategorySchedule({ blocks: config({ Mixed: { startTime: "11:35" } }), timing, teams, fixed: [] });
    expect(plan.conflicts).toEqual([]);
    expect(plan.blocks[0]).toMatchObject({ category: "Mens", finishMinutes: 10 * 60 + 35, earliestNextMinutes: 11 * 60 + 35, waves: 2 });
    // One minute earlier is a conflict, and it says by how much.
    const short = planCategorySchedule({ blocks: config({ Mixed: { startTime: "11:34" } }), timing, teams, fixed: [] });
    expect(short.conflicts).toEqual([expect.objectContaining({ kind: "OVERRUN", category: "Mens", nextCategory: "Mixed", shortByMinutes: 1, breakMinutes: 60 })]);
  });

  it("a break longer than 60 minutes is kept too: 150 minutes after Mixed", () => {
    const blocks = config({ Mixed: { startTime: "11:35", breakMinutes: 150 }, Womens: { startTime: "15:20" } });
    // Mixed: one wave 11:35–12:50, then 150 minutes: Women may start at 15:20.
    const plan = planCategorySchedule({ blocks, timing, teams, fixed: [] });
    expect(plan.blocks[1]).toMatchObject({ finishMinutes: 12 * 60 + 50, earliestNextMinutes: 15 * 60 + 20 });
    expect(plan.conflicts).toEqual([]);
    const early = planCategorySchedule({ blocks: config({ Mixed: { startTime: "11:35", breakMinutes: 150 }, Womens: { startTime: "15:00" } }), timing, teams, fixed: [] });
    expect(early.conflicts).toEqual([expect.objectContaining({ kind: "OVERRUN", category: "Mixed", shortByMinutes: 20, breakMinutes: 150 })]);
  });

  it("a category with no teams needs no break, but must not start before the one it follows", () => {
    const plan = planCategorySchedule({ blocks: config({ Mixed: { startTime: "08:00" } }), timing, teams: field({ Womens: { Open: 2 } }), fixed: [] });
    expect(plan.blocks[0]).toMatchObject({ finishMinutes: null, earliestNextMinutes: 9 * 60 });
    expect(plan.conflicts).toEqual([expect.objectContaining({ kind: "OVERRUN", category: "Mens", nextCategory: "Mixed", shortByMinutes: 60 })]);
  });
});

describe("scenario 4 — not enough time: a clear conflict with what is needed and what there is", () => {
  it("says how much time and how many places are missing", () => {
    // 40 Men at 7 per wave = 6 waves: 09:00 … 10:40, finishing 11:55; +60 = 12:55, but Mixed is at 12:00.
    const plan = planCategorySchedule({ blocks: config(), timing, teams: field({ Mens: { Open: 40 } }), fixed: [] });
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        kind: "OVERRUN", category: "Mens", nextCategory: "Mixed",
        finishMinutes: 11 * 60 + 55, earliestNextMinutes: 12 * 60 + 55, nextStartMinutes: 12 * 60,
        shortByMinutes: 55, requiredMinutes: 235, availableMinutes: 180,
        teamsToPlace: 40,
        // Waves may start 09:00 … 09:40 and still finish (10:55) an hour before 12:00: 3 waves of 7.
        placesInTime: 21,
        protectedWaves: [],
      }),
    ]);
    expect(touchesProtected(plan.conflicts[0])).toBe(false);
  });

  it("flags a day that runs past midnight, and one with no zones to time a wave by", () => {
    const late = planCategorySchedule({ blocks: config({ Womens: { startTime: "23:30" } }), timing, teams: field({ Womens: { Open: 1 } }), fixed: [] });
    expect(late.conflicts).toEqual([expect.objectContaining({ kind: "PAST_MIDNIGHT", category: "Womens", finishMinutes: 23 * 60 + 30 + 75 })]);
    expect(clockLabel(late.conflicts[0].kind === "PAST_MIDNIGHT" ? late.conflicts[0].finishMinutes : 0)).toBe("00:45 (+1)");
    const noZones = planCategorySchedule({ blocks: config(), timing: scheduleTiming(series, 0, 7), teams: [], fixed: [] });
    expect(noZones.conflicts).toContainEqual({ kind: "NO_ZONES" });
  });
});

describe("scenarios 6–9 — a team running manually stays in its exact slot", () => {
  /** Women team #500 moved by hand into the Mixed block's first wave (12:00), station 3. */
  const exception: FixedWave = {
    id: "wave-mixed-1", number: 3, startTime: "12:00", blockCategory: "Mixed",
    teams: [{ id: "w500", number: 500, category: "Womens", division: "Open", station: 3 }],
  };
  const teams = field({ Mens: { Open: 7 }, Mixed: { Open: 9 }, Womens: { Open: 2 } });
  const plan = planCategorySchedule({ blocks: config(), timing, teams, fixed: [exception] });

  it("keeps the wave (same id, same time), the station, and counts the station as taken", () => {
    expect(plan.conflicts).toEqual([]);
    const kept = plan.waves.find((wave) => wave.existingId === "wave-mixed-1")!;
    expect(kept).toMatchObject({ startTime: "12:00", block: "Mixed", previousNumber: 3 });
    expect(kept.seats.find((seat) => seat.protected)).toEqual({ teamId: "w500", teamNumber: 500, category: "Womens", station: 3, protected: true });
    // Mixed teams take the other six stations, never station 3.
    expect(kept.seats.filter((seat) => !seat.protected).map((seat) => seat.station)).toEqual([1, 2, 4, 5, 6, 7]);
    // The remaining three Mixed teams go to the next Mixed wave.
    expect(plan.waves.filter((wave) => wave.block === "Mixed").map((wave) => [wave.startTime, wave.seats.length])).toEqual([["12:00", 7], ["12:20", 3]]);
  });

  it("the exception is visible from both sides, and the team is counted once", () => {
    expect(plan.blocks.find((block) => block.category === "Mixed")!.hosting).toEqual([500]);
    expect(plan.blocks.find((block) => block.category === "Womens")!).toMatchObject({ elsewhere: [500], teams: 3 });
    const seats = plan.waves.flatMap((wave) => wave.seats.map((seat) => seat.teamId));
    expect(new Set(seats).size).toBe(seats.length);
    expect(seats.filter((id) => id === "w500")).toHaveLength(1);
  });

  it("running the plan again on its own result changes nothing for the protected team", () => {
    const again = planCategorySchedule({ blocks: config(), timing, teams, fixed: [exception] });
    expect(again.waves).toEqual(plan.waves);
  });

  it("new waves are laid around a kept wave that is off the grid", () => {
    const offGrid: FixedWave = { ...exception, startTime: "12:10" };
    const around = planCategorySchedule({ blocks: config(), timing, teams, fixed: [offGrid] });
    // 12:00 would start within 20 minutes of the kept 12:10 wave, as would 12:20: the next free slot is 12:40.
    expect(around.waves.filter((wave) => wave.block === "Mixed").map((wave) => wave.startTime)).toEqual(["12:10", "12:40"]);
    for (const [a, b] of around.waves.slice(1).map((wave, index) => [around.waves[index], wave])) {
      expect(b.startMinutes - a.startMinutes).toBeGreaterThanOrEqual(20);
    }
  });

  it("numbers the waves in running order — the kept wave's number follows its time", () => {
    expect(plan.waves.map((wave) => wave.number)).toEqual(plan.waves.map((_, index) => index + 1));
    expect(plan.waves.find((wave) => wave.existingId === "wave-mixed-1")!.number).toBe(2);
  });

  it("a hand-built wave with no block joins the block its time falls in", () => {
    const handBuilt: FixedWave = { ...exception, id: "hand", blockCategory: null, startTime: "15:20" };
    const result = planCategorySchedule({ blocks: config(), timing, teams, fixed: [handBuilt] });
    expect(result.waves.find((wave) => wave.existingId === "hand")!.block).toBe("Womens");
    expect(blockAt(config(), 8 * 60)).toBeNull();
    expect(blockAt(config(), 13 * 60)).toBe("Mixed");
  });
});

describe("scenario 12 — a schedule that no longer fits a protected slot is a conflict, never a relocation", () => {
  const protectedWave: FixedWave = {
    id: "w-men", number: 1, startTime: "09:00", blockCategory: "Mens",
    teams: [{ id: "m1", number: 1, category: "Mens", division: "Open", station: 6 }],
  };

  it("the block moved later than the protected wave", () => {
    const plan = planCategorySchedule({ blocks: config({ Mens: { startTime: "09:30" } }), timing, teams: [], fixed: [protectedWave] });
    expect(plan.conflicts).toContainEqual(expect.objectContaining({ kind: "PROTECTED_BEFORE_BLOCK", category: "Mens", waveNumber: 1, startTime: "09:00", blockStart: "09:30", teams: [1] }));
    // Kept exactly, all the same.
    expect(plan.waves[0]).toMatchObject({ existingId: "w-men", startTime: "09:00" });
    expect(plan.conflicts.every(touchesProtected)).toBe(true);
  });

  it("fewer teams per wave than the protected station", () => {
    const plan = planCategorySchedule({ blocks: config(), timing: scheduleTiming(series, 4, 5), teams: [], fixed: [protectedWave] });
    expect(plan.conflicts).toContainEqual({ kind: "PROTECTED_BEYOND_CAPACITY", waveNumber: 1, capacity: 5, teams: [1] });
  });

  it("the next category moved so early that the protected wave itself overruns into it", () => {
    const plan = planCategorySchedule({ blocks: config({ Mixed: { startTime: "10:00" } }), timing, teams: [], fixed: [protectedWave] });
    const overrun = plan.conflicts.find((conflict) => conflict.kind === "OVERRUN")!;
    expect(overrun).toMatchObject({ category: "Mens", protectedWaves: [1] });
    expect(touchesProtected(overrun)).toBe(true);
  });

  it("a protected wave before the first block starts belongs to no block", () => {
    const plan = planCategorySchedule({ blocks: config(), timing, teams: [], fixed: [{ ...protectedWave, blockCategory: null, startTime: "07:00" }] });
    expect(plan.conflicts).toContainEqual({ kind: "PROTECTED_OUTSIDE_SCHEDULE", waveNumber: 1, startTime: "07:00", teams: [1] });
  });
});

describe("scenario 16 — exceptions and the awards period", () => {
  const waves = [
    { startTime: "09:00", durationMinutes: 75, blockCategory: "Mens" as const },
    { startTime: "09:20", durationMinutes: 75, blockCategory: "Mens" as const },
    { startTime: "12:00", durationMinutes: 75, blockCategory: "Mixed" as const },
    { startTime: "14:00", durationMinutes: 75, blockCategory: "Womens" as const },
  ];
  const windows = awardsWindows(config(), waves);

  it("each category's awards period runs from its last wave's finish for its break", () => {
    expect(windows).toEqual([
      { category: "Mens", fromMinutes: 10 * 60 + 35, toMinutes: 11 * 60 + 35 },
      { category: "Mixed", fromMinutes: 13 * 60 + 15, toMinutes: 14 * 60 + 15 },
      { category: "Womens", fromMinutes: 15 * 60 + 15, toMinutes: 16 * 60 + 45 },
    ]);
  });

  it("a Men team moved into the Women block finishes after the Men awards begin; a Women team moved into Mixed does not", () => {
    expect(lateForAwards("Mens", 14 * 60 + 75, windows)).toEqual(windows[0]);
    expect(lateForAwards("Womens", 12 * 60 + 75, windows)).toBeNull();
    // Its own block's last wave is not late.
    expect(lateForAwards("Mens", 10 * 60 + 35, windows)).toBeNull();
  });

  it("outside its block only once there is a schedule", () => {
    expect(outsideItsBlock("Womens", "Mixed", true)).toBe(true);
    expect(outsideItsBlock("Womens", null, true)).toBe(true);
    expect(outsideItsBlock("Womens", "Womens", true)).toBe(false);
    expect(outsideItsBlock("Womens", "Mixed", false)).toBe(false);
  });
});

describe("a privacy review where the waiver's media rules meet", () => {
  it("flags a Women's team in a men's or mixed block, and a men's or mixed team in the women's block — nothing else", () => {
    expect(privacyReview("Womens", "Mixed")).toBe(true);
    expect(privacyReview("Mens", "Womens")).toBe(true);
    expect(privacyReview("Mixed", "Mens")).toBe(false);
    expect(privacyReview("Womens", "Womens")).toBe(false);
    expect(privacyReview("Womens", null)).toBe(false);
  });
});
