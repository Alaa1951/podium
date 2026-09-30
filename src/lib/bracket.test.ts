/**
 * The rules for changing a team's category or level — what is on offer, what
 * is refused, and why — as the server decides them and the panel draws them.
 */
import { describe, expect, it } from "vitest";

import { bracketClosesAt, bracketDoor, bracketFacts, bracketSide, categoryBlock, levelBlock, levelChoices, OPEN_LEVELS } from "@/lib/bracket";

const START = new Date("2026-10-10T06:00:00Z");
const HOUR = 3_600_000;
const before = (hours: number) => new Date(START.getTime() - hours * HOUR);
/** Not in a wave, no score, the competition's default cutoff: 24 hours before the start. */
const open = { archivedAt: null, waveId: null, waveStatus: null, scored: false, seriesStatus: "scheduled", seriesArchived: false, competitionDate: START, closeHours: 24 };
const WEEK_BEFORE = before(7 * 24);

describe("whose clock applies", () => {
  it("puts the athlete and their gym on the team's side; BFT MENA and event staff on the floor's", () => {
    expect(bracketSide({ role: "competitor" }, "athlete")).toBe("team");
    expect(bracketSide({ role: "studio" }, "staff")).toBe("team");
    for (const role of ["admin", "staff", "organiser"] as const) expect(bracketSide({ role }, "staff")).toBe("floor");
    // Nobody is on the floor's side for their OWN team.
    expect(bracketSide({ role: "admin" }, "athlete")).toBe("team");
  });
});

describe("the team's side — until the competition's own cutoff", () => {
  it("is open before the cutoff, for a team with no wave and for one placed in a wave that has not started", () => {
    expect(bracketDoor(open, "team", WEEK_BEFORE)).toEqual({ open: true });
    expect(bracketDoor({ ...open, waveId: "w1", waveStatus: "pending" }, "team", WEEK_BEFORE)).toEqual({ open: true });
  });

  it("closes exactly at the cutoff: 24 hours before the start by default", () => {
    expect(bracketClosesAt(open)).toEqual(before(24));
    expect(bracketDoor(open, "team", new Date(before(24).getTime() - 1))).toEqual({ open: true });
    expect(bracketDoor(open, "team", before(24))).toEqual({ open: false, reason: "TEAM_EDIT_CLOSED" });
    expect(bracketDoor(open, "team", before(1))).toEqual({ open: false, reason: "TEAM_EDIT_CLOSED" });
  });

  it("follows the competition's setting: 48 hours closes earlier, 2 hours later, 0 at the start itself", () => {
    expect(bracketDoor({ ...open, closeHours: 48 }, "team", before(30))).toEqual({ open: false, reason: "TEAM_EDIT_CLOSED" });
    expect(bracketDoor({ ...open, closeHours: 2 }, "team", before(3))).toEqual({ open: true });
    expect(bracketDoor({ ...open, closeHours: 2 }, "team", before(1))).toEqual({ open: false, reason: "TEAM_EDIT_CLOSED" });
    expect(bracketDoor({ ...open, closeHours: 0 }, "team", new Date(START.getTime() - 1))).toEqual({ open: true });
    expect(bracketDoor({ ...open, closeHours: 0 }, "team", START)).toEqual({ open: false, reason: "TEAM_EDIT_CLOSED" });
  });

  it("never once their wave has started, whatever the clock says", () => {
    for (const waveStatus of ["running", "complete"]) {
      expect(bracketDoor({ ...open, waveId: "w1", waveStatus }, "team", WEEK_BEFORE)).toEqual({ open: false, reason: "WAVE_STARTED" });
    }
  });
});

describe("the floor's side — BFT MENA and event staff, until the team has a score", () => {
  it("is open after the cutoff, minutes before the start, and after it", () => {
    for (const now of [WEEK_BEFORE, before(1), new Date(START.getTime() - 60_000), new Date(START.getTime() + HOUR)]) {
      expect(bracketDoor(open, "floor", now)).toEqual({ open: true });
    }
  });

  it("is open with the wave already on the floor, as long as nothing is scored", () => {
    expect(bracketDoor({ ...open, seriesStatus: "live", waveId: "w1", waveStatus: "running" }, "floor", START)).toEqual({ open: true });
    expect(bracketDoor({ ...open, seriesStatus: "live", waveId: "w1", waveStatus: "complete" }, "floor", START)).toEqual({ open: true });
  });
});

describe("what stops everybody, on either side", () => {
  it.each([
    ["the team has a score", { scored: true }, "TEAM_ALREADY_SCORED"],
    ["the competition is finished", { seriesStatus: "final" }, "SERIES_FINISHED"],
    ["the competition was archived", { seriesArchived: true }, "SERIES_FINISHED"],
    ["the team was withdrawn", { archivedAt: new Date() }, "NOT_FOUND"],
  ])("%s", (_label, over, reason) => {
    expect(bracketDoor({ ...open, ...over }, "team", WEEK_BEFORE)).toEqual({ open: false, reason });
    expect(bracketDoor({ ...open, ...over }, "floor", WEEK_BEFORE)).toEqual({ open: false, reason });
  });
});

describe("the category rule — the one pairing and sign-up already apply", () => {
  it("keeps a man out of Womens and a woman out of Mens", () => {
    expect(categoryBlock("Womens", ["f", "m"])).toBe("WOMENS_HAS_A_MAN");
    expect(categoryBlock("Mens", ["m", "f"])).toBe("MENS_HAS_A_WOMAN");
    expect(categoryBlock("Womens", ["f", "f"])).toBeNull();
    expect(categoryBlock("Mens", ["m", "m"])).toBeNull();
  });

  it("lets any pair into Mixed, and does not guess about somebody who never said", () => {
    for (const sexes of [["m", "f"], ["f", "f"], ["m", "m"], [null, null]]) expect(categoryBlock("Mixed", sexes)).toBeNull();
    expect(categoryBlock("Womens", ["f", null])).toBeNull();
    expect(categoryBlock("Womens", [null, undefined])).toBeNull();
    expect(categoryBlock("Mens", [null, "m"])).toBeNull();
  });
});

describe("the level rule — Rookie and Open either way; Pro is BFT MENA's", () => {
  it("moves between Rookie and Open in both directions for anybody who may change a bracket", () => {
    expect(OPEN_LEVELS).toEqual(["Rookie", "Open"]);
    expect(levelBlock("Open", "Rookie", false)).toBeNull();
    expect(levelBlock("Rookie", "Open", false)).toBeNull();
    expect(levelBlock("Open", "Open", false)).toBeNull();
  });

  it("refuses into or out of Pro unless BFT MENA is doing it", () => {
    expect(levelBlock("Open", "Pro", false)).toBe("PRO_IS_BFT_MENA");
    expect(levelBlock("Pro", "Rookie", false)).toBe("PRO_IS_BFT_MENA");
    expect(levelBlock("Open", "Pro", true)).toBeNull();
    expect(levelBlock("Pro", "Open", true)).toBeNull();
    // A Pro team changing only its category is not a level change.
    expect(levelBlock("Pro", "Pro", false)).toBeNull();
  });
});

describe("what the panel is told", () => {
  const team = { id: "t1", category: "Mixed" as const, division: "Open" as const, ...open };
  const athlete = { side: "team" as const, bft: false };
  const desk = { side: "floor" as const, bft: false };

  it("offers every category a mixed pair can enter, and says why the others are not on offer", () => {
    const facts = bracketFacts({ ...team, sexes: ["m", "f"] }, athlete, WEEK_BEFORE);
    expect(facts).toMatchObject({ teamId: "t1", category: "Mixed", division: "Open", side: "team", closed: null, proAllowed: false });
    expect(facts.blockedCategories).toEqual({ Womens: "WOMENS_HAS_A_MAN", Mens: "MENS_HAS_A_WOMAN" });
    expect(bracketFacts({ ...team, sexes: ["f", "f"] }, athlete, WEEK_BEFORE).blockedCategories).toEqual({ Mens: "MENS_HAS_A_WOMAN" });
    expect(bracketFacts({ ...team, sexes: [null, null] }, athlete, WEEK_BEFORE).blockedCategories).toEqual({});
  });

  it("never reports the team's own category as blocked", () => {
    // Entered as Womens by staff although one account says "m": the panel
    // still shows where the team IS.
    const facts = bracketFacts({ ...team, category: "Womens", sexes: ["f", "m"] }, athlete, WEEK_BEFORE);
    expect(facts.blockedCategories.Womens).toBeUndefined();
    expect(facts.blockedCategories).toEqual({ Mens: "MENS_HAS_A_WOMAN" });
  });

  it("tells the athlete when their side closes — and, past it, that it has; the desk has no clock to show", () => {
    expect(bracketFacts({ ...team, sexes: [] }, athlete, WEEK_BEFORE)).toMatchObject({ closed: null, closesAt: before(24).toISOString() });
    expect(bracketFacts({ ...team, sexes: [] }, athlete, before(2))).toMatchObject({ closed: "TEAM_EDIT_CLOSED", closesAt: before(24).toISOString() });
    expect(bracketFacts({ ...team, sexes: [] }, desk, before(2))).toMatchObject({ side: "floor", closed: null, closesAt: null });
    expect(bracketFacts({ ...team, sexes: [], scored: true }, desk, before(2)).closed).toBe("TEAM_ALREADY_SCORED");
    expect(bracketFacts({ ...team, sexes: [], waveId: "w1", waveStatus: "running" }, athlete, WEEK_BEFORE).closed).toBe("WAVE_STARTED");
  });

  it("offers Rookie and Open — and Pro only where it is in play", () => {
    expect(levelChoices({ division: "Open", proAllowed: false })).toEqual([
      { value: "Rookie", allowed: true },
      { value: "Open", allowed: true },
    ]);
    // BFT MENA may move a team into Pro.
    expect(levelChoices({ division: "Open", proAllowed: true }).map((one) => one.value)).toEqual(["Rookie", "Open", "Pro"]);
    // A Pro team seen by anybody else: Pro is shown as where it is; the way out is BFT MENA's.
    expect(levelChoices({ division: "Pro", proAllowed: false })).toEqual([
      { value: "Rookie", allowed: false },
      { value: "Open", allowed: false },
      { value: "Pro", allowed: true },
    ]);
  });
});
