import { describe, expect, it } from "vitest";
import type { BoardTeam } from "@/lib/board";
import { BRACKETS, bracketIndex } from "@/lib/scoring";
import { bracketStops, bracketViews, firstMarkedBracket, LIVE_BRACKET_ORDER, stationOrder } from "./running-board-scope";

function team(number: number, overrides: Partial<BoardTeam> = {}): BoardTeam {
  return {
    id: String(number), number, name: `Team ${number}`, category: "Mens", division: "Rookie",
    wave: 1, station: number, competitors: [], portraits: [], groupPortrait: null,
    studioName: null, submitted: false, scored: true, zones: [], total: 100 - number,
    ...overrides,
  };
}

const waves = [{ number: 1, status: "complete" as const }, { number: 2, status: "running" as const }];

describe("independent live prize brackets", () => {
  it("orders Men, Mixed, Women, with Rookie, Open, Pro in each", () => {
    expect(LIVE_BRACKET_ORDER.map((index) => BRACKETS[index])).toEqual(
      ["Mens", "Mixed", "Womens"].flatMap((category) => ["Rookie", "Open", "Pro"].map((division) => ({ category, division }))),
    );
  });

  it("starts ranks at one per bracket, never compares different categories or levels", () => {
    const views = bracketViews([
      team(1, { total: 20 }), team(2, { total: 30, wave: 2 }),
      team(3, { total: 900, category: "Mixed" }), team(4, { total: 800, division: "Open" }),
      team(5, { total: 10, category: "Womens" }),
    ], waves);
    expect(views.find((view) => view.index === bracketIndex("Mens", "Rookie"))?.rows.map((row) => [row.number, row.rank]))
      .toEqual([[2, 1], [1, 2]]);
    for (const view of views.filter((one) => one.rows.length)) {
      expect(view.rows[0].rank).toBe(1);
      expect(new Set(view.rows.map((row) => `${row.category}:${row.division}`)).size).toBe(1);
    }
  });

  it("selecting two brackets creates two stops with their own ranks", () => {
    const rookie = bracketIndex("Mixed", "Rookie");
    const open = bracketIndex("Mixed", "Open");
    const views = bracketViews([team(1), team(2, { category: "Mixed" }), team(3, { category: "Mixed", division: "Open" })], waves);
    expect(bracketStops(views, [open, rookie])).toEqual([{ id: rookie, pages: 1 }, { id: open, pages: 1 }]);
    expect(firstMarkedBracket([open, rookie])).toBe(rookie);
    expect(views.find((view) => view.index === rookie)?.rows[0].rank).toBe(1);
    expect(views.find((view) => view.index === open)?.rows[0].rank).toBe(1);
  });

  it("skips scoreless brackets and includes them after the first published zone", () => {
    const pending = team(2, { category: "Womens", scored: false, total: 0 });
    const before = bracketViews([team(1), pending], waves);
    expect(bracketStops(before, []).map((stop) => stop.id)).toEqual([3]);
    const after = bracketViews([team(1), { ...pending, scored: true }], waves);
    expect(bracketStops(after, []).map((stop) => stop.id)).toEqual([3, 0]);
    expect(after.find((view) => view.index === 0)?.rows[0]).toMatchObject({ total: 0, rank: 1 });
  });

  it("uses actual started waves, excluding unplaced and lower-numbered pending waves", () => {
    const views = bracketViews([
      team(1), team(2, { wave: 10 }), team(3, { wave: null }), team(4, { wave: 2 }),
    ], [{ number: 1, status: "complete" }, { number: 2, status: "pending" }, { number: 10, status: "running" }]);
    expect(views.flatMap((view) => view.rows.map((row) => row.number)).sort()).toEqual([1, 2]);
  });

  it("counts unscored teams for bracket progress without putting them on the ranking", () => {
    const view = bracketViews([team(1), team(2, { scored: false })], waves).find((one) => one.index === 3)!;
    expect(view.teams).toHaveLength(2);
    expect(view.rows).toHaveLength(1);
  });

  it("pages all 100 teams within their bracket and keeps ranks across pages", () => {
    const views = bracketViews(Array.from({ length: 100 }, (_, i) => team(i + 1)), waves);
    expect(bracketStops(views, [])).toEqual([{ id: 3, pages: 9 }]);
    expect(views.find((view) => view.index === 3)?.rows.slice(12, 24).map((row) => row.rank))
      .toEqual(Array.from({ length: 12 }, (_, i) => i + 13));
  });

  it("preserves shared ranks for ties inside each bracket", () => {
    const rows = bracketViews([team(1, { total: 30 }), team(2, { total: 20 }), team(3, { total: 20 }), team(4, { total: 10 })], waves)
      .find((view) => view.index === 3)!.rows;
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
  });

  it("orders the floor by station and number independently of score", () => {
    const teams = [team(1, { station: 2, total: 999 }), team(3, { station: 1 }), team(2, { station: 1 }), team(4, { station: null })];
    expect(stationOrder(teams).map((row) => row.number)).toEqual([2, 3, 1, 4]);
    expect(teams[0].number).toBe(1);
    expect(stationOrder(teams).some((row) => "rank" in row)).toBe(false);
  });
});
