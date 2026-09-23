/**
 * Letting somebody in when there is room for them.
 *
 * The waiting list exists so that money cannot buy a place. This is the one
 * thing allowed to hand one out without a person pressing anything, so the
 * limits on it are the subject: only an existing wave, only a free rig, and
 * only one pair per rig however many polls are running.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The subject takes its client as a parameter, so the fake is passed in.
// The module mock exists only so importing it does not open a connection for
// the DEFAULT argument, which no test here uses.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const mocks = vi.hoisted(() => ({
  findTeam: vi.fn(),
  findWaves: vi.fn(),
  updateMany: vi.fn(),
}));

const { admitIfRoom } = await import("@/lib/crm/admit");

const db = {
  team: { findUnique: mocks.findTeam, updateMany: mocks.updateMany },
  wave: { findMany: mocks.findWaves },
} as never;

const waiting = {
  id: "t1",
  seriesId: "s1",
  category: "Mens",
  division: "Open",
  waitlistedAt: new Date("2026-09-20T00:00:00Z"),
};

/** A wave with `capacity` rigs, `taken` of them occupied. */
function wave(number: number, capacity: number, taken: number[], bracket = "Mens/Open") {
  const [category, division] = bracket.split("/");
  return {
    id: `w${number}`,
    number,
    capacity,
    teams: taken.map((station) => ({ station, category, division })),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findTeam.mockResolvedValue(waiting);
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("when there is room", () => {
  it("takes the lowest free rig and clears the waiting mark in one write", async () => {
    mocks.findWaves.mockResolvedValue([wave(1, 7, [1, 2, 3])]);

    await expect(admitIfRoom(db, "t1")).resolves.toEqual({
      admitted: true,
      waveNumber: 1,
      station: 4,
    });

    // One write, not "check then admit" — see the race test below.
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", waitlistedAt: { not: null } },
      data: { waitlistedAt: null, waveId: "w1", wave: 1, station: 4 },
    });
  });

  // `autoAssignWaves` groups brackets on purpose — one set of prescribed
  // loads per floor. Dropping a Mixed Pro pair into a wave of Womens Rookie
  // undoes that quietly, and nobody would know until the rigs were loaded.
  it("prefers a wave already running the same bracket", async () => {
    mocks.findWaves.mockResolvedValue([
      wave(1, 7, [1], "Womens/Rookie"),
      wave(2, 7, [1, 2], "Mens/Open"),
    ]);

    await expect(admitIfRoom(db, "t1")).resolves.toMatchObject({ waveNumber: 2, station: 3 });
  });

  it("fills the day from the front when no wave shares the bracket", async () => {
    mocks.findWaves.mockResolvedValue([
      wave(1, 7, [1, 2], "Womens/Rookie"),
      wave(2, 7, [], "Womens/Rookie"),
    ]);

    await expect(admitIfRoom(db, "t1")).resolves.toMatchObject({ waveNumber: 1, station: 3 });
  });

  // A waiting team holds no place, so it must not be counted as occupying one
  // — otherwise the queue blocks itself out of its own free rigs.
  it("does not count waiting teams as holding a rig", async () => {
    mocks.findWaves.mockResolvedValue([wave(1, 7, [1, 2, 3])]);
    await admitIfRoom(db, "t1");
    expect(mocks.findWaves.mock.calls[0][0].select.teams.where).toEqual({
      archivedAt: null,
      waitlistedAt: null,
    });
  });
});

describe("when there is not", () => {
  // THE RULE THAT KEEPS THIS SAFE. Building the running order is planning,
  // and planning is a person's job: a poll that could add waves could let in
  // an unbounded number of pairs overnight and rearrange the whole day.
  it("never creates a wave — a full floor is simply full", async () => {
    mocks.findWaves.mockResolvedValue([wave(1, 7, [1, 2, 3, 4, 5, 6, 7])]);
    await expect(admitIfRoom(db, "t1")).resolves.toEqual({ admitted: false, reason: "NO_ROOM" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("has nowhere to put anybody when no wave has been planned yet", async () => {
    mocks.findWaves.mockResolvedValue([]);
    await expect(admitIfRoom(db, "t1")).resolves.toEqual({ admitted: false, reason: "NO_ROOM" });
  });

  // Only waves still to run. A wave on the floor is not a place to put
  // somebody who has not been standing there since it started.
  it("looks only at waves that have not started", async () => {
    mocks.findWaves.mockResolvedValue([wave(1, 7, [])]);
    await admitIfRoom(db, "t1");
    expect(mocks.findWaves.mock.calls[0][0].where).toMatchObject({ status: "pending" });
  });

  it("refuses a team that is not waiting in the first place", async () => {
    mocks.findTeam.mockResolvedValue({ ...waiting, waitlistedAt: null });
    await expect(admitIfRoom(db, "t1")).resolves.toEqual({ admitted: false, reason: "NOT_WAITING" });
    expect(mocks.findWaves).not.toHaveBeenCalled();
  });
});

describe("two polls at the same rig", () => {
  // THE ONE THAT MATTERS. Checking for room and then admitting would let two
  // pairs see the same free station. The write is conditional on still being
  // on the list, so exactly one of them wins and the other simply waits.
  it("hands the place to exactly one of them", async () => {
    mocks.findWaves.mockResolvedValue([wave(1, 7, [1])]);
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const [first, second] = await Promise.all([admitIfRoom(db, "t1"), admitIfRoom(db, "t1")]);
    const winners = [first, second].filter((one) => one.admitted);
    expect(winners).toHaveLength(1);
    expect([first, second].find((one) => !one.admitted)).toEqual({
      admitted: false,
      reason: "TAKEN",
    });
  });

  // The unique index on (waveId, station) is the real arbiter; a rejected
  // write is somebody else's rig, not a failure worth reporting.
  it("treats a lost rig as a wait, not an error", async () => {
    mocks.findWaves.mockResolvedValue([wave(1, 7, [1])]);
    mocks.updateMany.mockRejectedValue(new Error("Unique constraint failed"));
    await expect(admitIfRoom(db, "t1")).resolves.toEqual({ admitted: false, reason: "TAKEN" });
  });
});
