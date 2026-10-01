/**
 * The figures and lists of the two check-in desks. Every count on a card is
 * the count of the rows under it, teams and athletes are never one number,
 * and an absent partner is never counted as present.
 */
import { describe, expect, it } from "vitest";

import {
  arrivalStatus,
  checkInTotals,
  matchesEntrance,
  matchesWarmup,
  totalsByBracket,
  warmupGroups,
  warmupTotals,
  type CheckInTeam,
  type WarmupWave,
} from "@/lib/checkin";

let seat = 0;
function team(number: number, arrived: boolean[], over: Partial<CheckInTeam> = {}): CheckInTeam {
  return {
    id: `t${number}`,
    number,
    name: `TEAM ${number}`,
    category: "Mixed",
    division: "Open",
    studio: null,
    waveId: null,
    waveNumber: null,
    station: null,
    competing: true,
    ready: false,
    athletes: arrived.map((here, index) => ({ id: `a${++seat}`, fullName: `Athlete ${number}-${index + 1}`, arrived: here, waiver: "not_required" as const })),
    ...over,
  };
}

const field = () => [
  team(1, [true, true], { category: "Womens", division: "Rookie", name: "FALCONS", waveId: "w1", waveNumber: 1, station: 2, ready: true }),
  team(2, [true, false], { category: "Womens", division: "Rookie", waveId: "w1", waveNumber: 1, station: 1 }),
  team(3, [false, false], { category: "Mixed", division: "Open", waveId: "w2", waveNumber: 2, station: 1, ready: true }),
  team(4, [true], { category: "Mens", division: "Open" }),
  team(5, [false, false], { category: "Mixed", division: "Open", studio: "Studio A", waveId: "w2", waveNumber: 2, station: 3 }),
];

describe("arrival — everyone, some of them, or nobody", () => {
  it("is checked in only when every athlete on the team is here", () => {
    expect(arrivalStatus(team(1, [true, true]))).toBe("in");
    expect(arrivalStatus(team(1, [true, false]))).toBe("partial");
    expect(arrivalStatus(team(1, [false, false]))).toBe("out");
  });

  it("treats a one-seat team by its one athlete, and a team with nobody as not arrived", () => {
    expect(arrivalStatus(team(1, [true]))).toBe("in");
    expect(arrivalStatus(team(1, [false]))).toBe("out");
    expect(arrivalStatus(team(1, []))).toBe("out");
  });
});

describe("the totals — teams and athletes, counted apart", () => {
  it("counts each of the six figures from the same rows", () => {
    expect(checkInTotals(field())).toEqual({
      teams: { registered: 5, checkedIn: 2, notCheckedIn: 3, partial: 1 },
      athletes: { registered: 9, checkedIn: 4, notCheckedIn: 5 },
    });
  });

  it("never counts the absent partner of a partly arrived team as present", () => {
    const totals = checkInTotals([team(1, [true, false])]);
    expect(totals.teams).toEqual({ registered: 1, checkedIn: 0, notCheckedIn: 1, partial: 1 });
    expect(totals.athletes).toEqual({ registered: 2, checkedIn: 1, notCheckedIn: 1 });
  });

  it("adds up: checked in plus not yet is everyone, for teams and for athletes", () => {
    const totals = checkInTotals(field());
    expect(totals.teams.checkedIn + totals.teams.notCheckedIn).toBe(totals.teams.registered);
    expect(totals.athletes.checkedIn + totals.athletes.notCheckedIn).toBe(totals.athletes.registered);
    expect(checkInTotals([])).toEqual({ teams: { registered: 0, checkedIn: 0, notCheckedIn: 0, partial: 0 }, athletes: { registered: 0, checkedIn: 0, notCheckedIn: 0 } });
  });

  it("groups the same figures by category and level, in board order, leaving empty brackets out", () => {
    const rows = totalsByBracket(field());
    expect(rows.map((row) => `${row.category} ${row.division}`)).toEqual(["Womens Rookie", "Mens Open", "Mixed Open"]);
    expect(rows[0]).toMatchObject({ teams: { registered: 2, checkedIn: 1, notCheckedIn: 1, partial: 1 }, athletes: { registered: 4, checkedIn: 3, notCheckedIn: 1 } });
    expect(rows[2]).toMatchObject({ teams: { registered: 2, checkedIn: 0 }, athletes: { registered: 4, checkedIn: 0 } });
    // The brackets together are the whole field.
    expect(rows.reduce((sum, row) => sum + row.teams.registered, 0)).toBe(5);
    expect(rows.reduce((sum, row) => sum + row.athletes.checkedIn, 0)).toBe(4);
  });

  it("moves a team to its new bracket's totals when its category or level changes — with its check-in intact", () => {
    const before = field();
    const after = before.map((one) => (one.number === 1 ? { ...one, category: "Mixed" as const, division: "Open" as const } : one));
    expect(totalsByBracket(after).find((row) => row.category === "Womens")).toMatchObject({ teams: { registered: 1, checkedIn: 0 } });
    expect(totalsByBracket(after).find((row) => row.category === "Mixed")).toMatchObject({ teams: { registered: 3, checkedIn: 1 }, athletes: { checkedIn: 2 } });
    // Nothing about who has arrived changed.
    expect(checkInTotals(after)).toEqual(checkInTotals(before));
  });
});

describe("the entrance list — search, category, level and status", () => {
  const all = { q: "", category: "", division: "", status: "" };
  const numbers = (filter: Partial<typeof all>) => field().filter((one) => matchesEntrance(one, { ...all, ...filter })).map((one) => one.number);

  it("shows everybody with no filter", () => {
    expect(numbers({})).toEqual([1, 2, 3, 4, 5]);
    expect(numbers({ category: "all", division: "all", status: "all" })).toEqual([1, 2, 3, 4, 5]);
  });

  it("filters by category and by level", () => {
    expect(numbers({ category: "Womens" })).toEqual([1, 2]);
    expect(numbers({ division: "Open" })).toEqual([3, 4, 5]);
    expect(numbers({ category: "Mixed", division: "Open" })).toEqual([3, 5]);
  });

  it("filters by check-in status, matching the totals card for card", () => {
    const totals = checkInTotals(field());
    expect(numbers({ status: "in" })).toHaveLength(totals.teams.checkedIn);
    expect(numbers({ status: "pending" })).toHaveLength(totals.teams.notCheckedIn);
    expect(numbers({ status: "partial" })).toHaveLength(totals.teams.partial);
    expect(numbers({ status: "in" })).toEqual([1, 4]);
    expect(numbers({ status: "pending" })).toEqual([2, 3, 5]);
    expect(numbers({ status: "partial" })).toEqual([2]);
  });

  it("finds a team by its name, an athlete's name, its gym, or its number exactly", () => {
    expect(numbers({ q: "falcons" })).toEqual([1]);
    expect(numbers({ q: "athlete 3-2" })).toEqual([3]);
    expect(numbers({ q: "studio a" })).toEqual([5]);
    expect(numbers({ q: "4" })).toEqual([4]);
    expect(numbers({ q: "nobody" })).toEqual([]);
  });
});

describe("the warm-up checklists — one per wave", () => {
  const waves: WarmupWave[] = [
    { id: "w2", number: 2, startTime: "09:20", status: "pending" },
    { id: "w1", number: 1, startTime: "09:00", status: "running" },
    { id: "w3", number: 3, startTime: "09:40", status: "pending" },
  ];

  it("groups teams by wave in running order, by station, with ready and pending counts", () => {
    const groups = warmupGroups(field(), waves);
    expect(groups.map((group) => group.wave?.number ?? null)).toEqual([1, 2, null]);
    expect(groups[0].teams.map((one) => one.number)).toEqual([2, 1]); // station 1, then 2
    expect(groups[0]).toMatchObject({ ready: 1, pending: 1 });
    expect(groups[1]).toMatchObject({ ready: 1, pending: 1 });
    // A team not placed yet still has to be found: its own list, at the end.
    expect(groups[2].teams.map((one) => one.number)).toEqual([4]);
  });

  it("leaves out a wave none of these teams is in (a gym sees only its own waves)", () => {
    expect(warmupGroups(field(), waves).some((group) => group.wave?.number === 3)).toBe(false);
  });

  it("counts ready and pending over all teams", () => {
    expect(warmupTotals(field())).toEqual({ teams: 5, ready: 2, pending: 3 });
  });

  it("keeps readiness and arrival apart: a ready team may not have arrived, an arrived team is not ready", () => {
    const teams = field();
    const notArrivedButReady = teams.find((one) => one.number === 3)!;
    expect(arrivalStatus(notArrivedButReady)).toBe("out");
    expect(notArrivedButReady.ready).toBe(true);
    const arrivedNotReady = teams.find((one) => one.number === 4)!;
    expect(arrivalStatus(arrivedNotReady)).toBe("in");
    expect(arrivedNotReady.ready).toBe(false);
  });

  const all = { q: "", category: "", division: "", wave: "", readiness: "" };
  const numbers = (filter: Partial<typeof all>) => field().filter((one) => matchesWarmup(one, { ...all, ...filter })).map((one) => one.number);

  it("filters by wave, readiness, category, level and search", () => {
    expect(numbers({})).toEqual([1, 2, 3, 4, 5]);
    expect(numbers({ wave: "w1" })).toEqual([1, 2]);
    expect(numbers({ wave: "none" })).toEqual([4]);
    expect(numbers({ readiness: "ready" })).toEqual([1, 3]);
    expect(numbers({ readiness: "pending" })).toEqual([2, 4, 5]);
    expect(numbers({ wave: "w2", readiness: "pending" })).toEqual([5]);
    expect(numbers({ category: "Womens", division: "Rookie", readiness: "ready" })).toEqual([1]);
    expect(numbers({ q: "athlete 5-1" })).toEqual([5]);
  });
});
