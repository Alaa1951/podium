/**
 * The marshalling screen's plan: what is in each zone, where each wave goes
 * next, and who to call up — the same arithmetic as the judge sheet.
 */
import { describe, expect, it } from "vitest";

import type { FloorTiming, PlannedWave } from "@/lib/floor";
import { marshallingPlan } from "@/lib/marshalling";

const FOUR: FloorTiming = { workMinutes: 15, breakMinutes: 5, zoneCount: 4 };
const start = new Date("2026-10-03T08:00:00Z");
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

const wave = (id: string, number: number, extra: Partial<PlannedWave> = {}): PlannedWave => ({
  id,
  number,
  status: "pending",
  startedAt: null,
  endsAt: null,
  plannedStart: at(number * 20),
  hasTeams: true,
  ...extra,
});
const running = (id: string, number: number, startedMinutes: number) =>
  wave(id, number, { status: "running", startedAt: at(startedMinutes), endsAt: at(startedMinutes + 75) });

describe("marshalling", () => {
  it("shows what is in each zone and what comes next", () => {
    // At 25: wave 1 works Zone 2; wave 2 (started at 20) works Zone 1.
    const plan = marshallingPlan([running("w1", 1, 0), running("w2", 2, 20), wave("w3", 3)], FOUR, at(25));
    expect(plan.zones[0].current).toMatchObject({ waveId: "w2", phase: "work" });
    expect(plan.zones[1].current).toMatchObject({ waveId: "w1", phase: "work", endsAt: at(35) });
    expect(plan.zones[2].current).toBeNull();
    expect(plan.zones[2].next).toEqual({ waveId: "w1", arrivesAt: at(40), estimated: false });
    // Zone 1 is busy with wave 2 until 40 (15 work + 5 change), so wave 3 then.
    expect(plan.zones[0].next).toEqual({ waveId: "w3", arrivesAt: at(60), estimated: true });
  });

  it("says where each wave on the floor goes next, soonest first", () => {
    const plan = marshallingPlan([running("w1", 1, 0), running("w2", 2, 20)], FOUR, at(25));
    expect(plan.moves).toEqual([
      { waveId: "w1", toZoneIndex: 2, at: at(40) },
      { waveId: "w2", toZoneIndex: 1, at: at(40) },
    ]);
  });

  it("says a wave in the last zone goes to the finish", () => {
    const plan = marshallingPlan([running("w1", 1, 0)], FOUR, at(65));
    expect(plan.moves).toEqual([{ waveId: "w1", toZoneIndex: null, at: at(75) }]);
  });

  it("calls up the next two waves with teams, in start order", () => {
    const plan = marshallingPlan(
      [running("w1", 1, 0), wave("w2", 2, { hasTeams: false }), wave("w3", 3), wave("w4", 4), wave("w5", 5)],
      FOUR,
      at(5)
    );
    expect(plan.callUp.map((row) => row.waveId)).toEqual(["w3", "w4"]);
    expect(plan.callUp[0]).toMatchObject({ estimated: true, overdue: false, startsAt: at(60) });
  });

  it("marks a call-up overdue when its planned start has passed", () => {
    const plan = marshallingPlan([wave("w1", 1, { plannedStart: at(0) })], FOUR, at(10));
    expect(plan.callUp[0]).toMatchObject({ waveId: "w1", overdue: true, startsAt: at(10) });
  });

  it("ignores ended waves", () => {
    const ended = wave("w1", 1, { status: "complete", startedAt: at(0), endsAt: at(30) });
    const plan = marshallingPlan([ended], FOUR, at(31));
    expect(plan.moves).toEqual([]);
    expect(plan.zones.every((zone) => zone.current === null)).toBe(true);
  });
});
