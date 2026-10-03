import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({ seats: vi.fn(), states: vi.fn() }));
vi.mock("@/lib/waivers/waiver-db", () => ({ seatsOf: mocks.seats, waiverStates: mocks.states }));

import { waveStartBlockers } from "@/lib/wave-start-check";

const tx = {
  $queryRaw: vi.fn(),
  team: { findMany: vi.fn() },
};
const db = tx as unknown as Prisma.TransactionClient;

beforeEach(() => {
  vi.clearAllMocks();
  tx.$queryRaw.mockResolvedValueOnce([{ id: "t1" }]).mockResolvedValueOnce([{ id: "a1" }]);
  tx.team.findMany.mockResolvedValue([{ id: "t1", number: 1, name: "ONE", waveId: "w1", warmupReadyAt: null, warmupWaveId: null }]);
  mocks.seats.mockResolvedValue([{ teamId: "t1", competitorId: "a1", fullName: "Athlete", attendedAt: null }]);
  mocks.states.mockResolvedValue(new Map([["a1", "no_account"]]));
});

describe("wave start readiness under the emergency override", () => {
  it("retains team and athlete locks but waives waiver, entrance and warm-up", async () => {
    expect(await waveStartBlockers(db, "w1", "s1", true)).toEqual([]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.calls[0][0].join("")).toContain("SELECT id FROM Team WHERE waveId =  FOR UPDATE");
    expect(tx.$queryRaw.mock.calls[1][0].join("")).toContain("SELECT id FROM Competitor WHERE teamId IN () FOR UPDATE");
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.team.findMany.mock.invocationCallOrder[0]);
    expect(mocks.states).not.toHaveBeenCalled();
  });

  it("keeps the normal readiness gates without the override", async () => {
    expect(await waveStartBlockers(db, "w1", "s1")).toEqual([{
      team: { id: "t1", number: 1, name: "ONE" }, gaps: ["warmup"],
      athletes: [{ id: "a1", name: "Athlete", gaps: ["account", "entrance"] }],
    }]);
    expect(mocks.states).toHaveBeenCalledWith(db, "s1", expect.any(Array));
  });

  it("still refuses a team with no athletes", async () => {
    mocks.seats.mockResolvedValue([]);
    expect(await waveStartBlockers(db, "w1", "s1", true)).toEqual([{
      team: { id: "t1", number: 1, name: "ONE" }, gaps: ["no_athletes"], athletes: [],
    }]);
    expect(mocks.states).not.toHaveBeenCalled();
  });
});
