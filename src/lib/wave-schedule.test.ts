import { describe, expect, it } from "vitest";
import { assignmentPlan, orderedScheduleTeams, scheduledTime, SCHEDULE_CATEGORIES, SCHEDULE_DIVISIONS } from "@/lib/wave-schedule";

describe("wave running order", () => {
  it("groups all nine brackets in the requested order, preserving number order", () => {
    const teams = SCHEDULE_CATEGORIES.flatMap(category => SCHEDULE_DIVISIONS.flatMap(division =>
      [12, 3].map(number => ({ category, division, number })))).reverse();
    expect(orderedScheduleTeams(teams).map(t => `${t.category}/${t.division}/${t.number}`)).toEqual([
      "Mens/Rookie/3", "Mens/Rookie/12", "Mens/Open/3", "Mens/Open/12", "Mens/Pro/3", "Mens/Pro/12",
      "Mixed/Rookie/3", "Mixed/Rookie/12", "Mixed/Open/3", "Mixed/Open/12", "Mixed/Pro/3", "Mixed/Pro/12",
      "Womens/Rookie/3", "Womens/Rookie/12", "Womens/Open/3", "Womens/Open/12", "Womens/Pro/3", "Womens/Pro/12",
    ]);
  });
  it.each(["Mens", "Mixed", "Womens"] as const)("fills the seventh station from the next %s level", category => {
    const plan = assignmentPlan([
      ...Array.from({ length: 6 }, (_, number) => ({ category, division: "Rookie" as const, number })),
      { category, division: "Open" as const, number: 10 },
    ], 7);
    expect(plan.map(p => p.number)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(plan.map(p => p.station)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(plan[6].team.division).toBe("Open");
  });
  it("continues from Men to Mixed to Women, with only the last wave incomplete", () => {
    const plan = assignmentPlan([
      ...Array.from({ length: 6 }, (_, number) => ({ category: "Mens" as const, division: "Pro" as const, number })),
      ...Array.from({ length: 6 }, (_, number) => ({ category: "Mixed" as const, division: "Open" as const, number })),
      ...Array.from({ length: 3 }, (_, number) => ({ category: "Womens" as const, division: "Rookie" as const, number })),
    ], 7);
    expect(plan[6]).toMatchObject({ number: 1, station: 7, team: { category: "Mixed" } });
    expect(plan[12]).toMatchObject({ number: 2, station: 6, team: { category: "Womens" } });
    expect(plan[14]).toMatchObject({ number: 3, station: 1 });
    expect(new Set(plan.map(p => `${p.number}/${p.station}`)).size).toBe(15);
  });
  it("does not invent a wave for an empty field", () => expect(assignmentPlan([], 7)).toEqual([]));
  it.each([0, 10, 1.5])("rejects invalid capacity %s", capacity => expect(() => assignmentPlan([], capacity)).toThrow("INVALID_INPUT"));
});

describe("estimated starts", () => {
  it("uses the start interval, not the full wave duration", () => {
    expect([0, 1, 2].map(index => scheduledTime("07:00", 20, index))).toEqual(["07:00", "07:20", "07:40"]);
    expect(scheduledTime("09:10", 25, 3)).toBe("10:25");
  });
  it("allows the last minute but refuses midnight rollover", () => {
    expect(scheduledTime("23:39", 20, 1)).toBe("23:59");
    expect(() => scheduledTime("23:40", 20, 1)).toThrow("SCHEDULE_EXCEEDS_DAY");
  });
  it.each(["24:00", "07:60", "7:00", "-1:00"])("rejects invalid clock %s", clock => expect(() => scheduledTime(clock, 20, 0)).toThrow("INVALID_INPUT"));
  it.each([0, -1, 2.5, 1441])("rejects invalid interval %s", interval => expect(() => scheduledTime("07:00", interval, 0)).toThrow("INVALID_INPUT"));
});
