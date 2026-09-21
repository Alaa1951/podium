/**
 * The screens over the rigs.
 *
 * The test that earns its place is the AMBIGUITY one: at a single instant, two
 * different waves are on the floor in two different zones, and each has a team
 * on station 3. A screen asking only "who is on station 3?" has two answers,
 * and would show the room the wrong pair. So the pair of assertions that
 * station 3 of zone 1 and station 3 of zone 2 return DIFFERENT teams is what
 * pins the whole design.
 *
 * Second: the break. A pair stays on their rig through the changeover while the
 * judge finishes their sheet, so the screen must not go blank at the buzzer —
 * that is how a sheet gets filed against the wrong team.
 */
import { describe, expect, it } from "vitest";

import type { BoardTeam } from "@/lib/board";
import { stationView, zoneStations } from "@/lib/stations";
import type { WaveState } from "@/lib/waves";

function wave(
  number: number,
  floor: Partial<WaveState["floor"]> & { zoneNumber: number | null },
  capacity = 9
): WaveState {
  return {
    id: `w${number}`,
    number,
    status: "running",
    capacity,
    durationMinutes: 30,
    startTime: "09:00",
    remainingMs: null,
    endsAt: null,
    stoppedRemainingMs: null,
    teamCount: 9,
    scoredCount: 0,
    startedAt: new Date().toISOString(),
    floor: { phase: "work", phaseRemainingMs: 60_000, ...floor },
  };
}

function team(number: number, waveNumber: number, station: number | null): BoardTeam {
  return {
    id: `t${number}`,
    number,
    name: `TEAM ${number}`,
    category: "Womens",
    division: "Open",
    wave: waveNumber,
    station,
    competitors: ["A", "B"],
    portraits: ["/brand/athlete-default.svg", "/brand/athlete-default.svg"],
    groupPortrait: null,
    studioName: "Studio A",
    submitted: false,
    zones: [],
    total: 0,
  };
}

// Two waves on the floor at once, one zone apart — the ordinary case, not an
// edge case: a new wave enters zone 1 every twenty minutes.
const waves = [wave(1, { zoneNumber: 2 }), wave(2, { zoneNumber: 1 })];
const teams = [
  team(101, 1, 3),
  team(102, 1, 4),
  team(201, 2, 3),
  team(202, 2, 5),
];

describe("a screen is addressed by zone AND station", () => {
  it("returns DIFFERENT teams for the same station in two zones", () => {
    const zoneOne = stationView({ waves, teams, zoneNumber: 1, station: 3 });
    const zoneTwo = stationView({ waves, teams, zoneNumber: 2, station: 3 });

    expect(zoneOne).toMatchObject({ state: "team", wave: 2 });
    expect(zoneTwo).toMatchObject({ state: "team", wave: 1 });
    expect(zoneOne.state === "team" && zoneOne.team.number).toBe(201);
    expect(zoneTwo.state === "team" && zoneTwo.team.number).toBe(101);
  });

  it("never mixes a team from another wave into this zone", () => {
    // Station 5 exists in wave 2 only. Zone 2 holds wave 1, so it must read as
    // an unused rig — not as wave 2's team 202.
    expect(stationView({ waves, teams, zoneNumber: 2, station: 5 })).toMatchObject({
      state: "empty",
      wave: 1,
    });
  });
});

describe("the changeover", () => {
  it("keeps the pair on screen through the break", () => {
    // The judge is still writing. Going blank here is how a sheet ends up
    // against the wrong team.
    const mid = [wave(1, { zoneNumber: 1, phase: "break", phaseRemainingMs: 30_000 })];
    const view = stationView({ waves: mid, teams, zoneNumber: 1, station: 3 });
    expect(view).toMatchObject({ state: "team", phase: "break", phaseRemainingMs: 30_000 });
  });
});

describe("when nobody is there", () => {
  it("is idle before anything has started", () => {
    const pending = [wave(1, { zoneNumber: null, phase: "pending", phaseRemainingMs: null })];
    expect(stationView({ waves: pending, teams, zoneNumber: 1, station: 3 })).toEqual({
      state: "idle",
    });
  });

  it("is idle for a zone no wave has reached", () => {
    expect(stationView({ waves, teams, zoneNumber: 5, station: 3 })).toEqual({ state: "idle" });
  });

  it("is idle once a wave is done, even though it has a zone number", () => {
    // `floor.zoneNumber` is "the zone it is in, or has just left", so a done
    // wave still carries one. Only work and break put anybody on a rig.
    const done = [wave(1, { zoneNumber: 3, phase: "done", phaseRemainingMs: null })];
    expect(stationView({ waves: done, teams, zoneNumber: 3, station: 1 })).toEqual({
      state: "idle",
    });
  });

  it("reads a rig with no team as empty, not as idle", () => {
    // The difference matters on a wall: "nobody is competing here right now" is
    // not the same message as "this rig is not in use for this wave".
    expect(stationView({ waves, teams, zoneNumber: 1, station: 9 })).toMatchObject({
      state: "empty",
      wave: 2,
    });
  });

  it("treats a team with no station assigned as not on any rig", () => {
    const unplaced = [team(301, 2, null)];
    expect(stationView({ waves, teams: unplaced, zoneNumber: 1, station: 1 })).toMatchObject({
      state: "empty",
    });
  });
});

describe("a whole zone at once", () => {
  it("draws as many rigs as the wave actually uses, not nine", () => {
    // A wave set to six teams must not draw nine rigs with three permanently
    // dark — the screen would look broken.
    const six = [wave(2, { zoneNumber: 1 }, 6)];
    const rigs = zoneStations({ waves: six, teams, zoneNumber: 1 });
    expect(rigs).toHaveLength(6);
    expect(rigs.map((one) => one.station)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("puts each team on its own rig, in order", () => {
    const rigs = zoneStations({ waves, teams, zoneNumber: 1 });
    const occupied = rigs.filter((one) => one.view.state === "team");
    expect(occupied.map((one) => one.station)).toEqual([3, 5]);
  });

  it("shows nothing at all when no wave is in the zone", () => {
    expect(zoneStations({ waves, teams, zoneNumber: 7 })).toEqual([]);
  });
});
