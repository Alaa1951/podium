/**
 * Placing a team on a station.
 *
 * The capacity of a wave is what a screen draws and what auto-placement
 * fills, but the only place it is ENFORCED is here — and a station past it is
 * a rig that is not on the floor. That check has no visible effect anywhere
 * else, so nothing would fail if somebody removed it; a team would simply
 * turn up on the morning standing at a rig nobody built.
 *
 * The error CODE is part of the contract, not decoration. The screen tells
 * somebody which numbers their wave actually runs, and it can only do that if
 * this returns something more specific than "invalid input".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const requireAccess = vi.fn();
  const findTeam = vi.fn();
  const findOccupant = vi.fn();
  const countTeams = vi.fn();
  const updateTeam = vi.fn();
  const transaction = vi.fn();
  return {
    requireAccess,
    findTeam,
    findOccupant,
    countTeams,
    updateTeam,
    transaction,
    revalidate: vi.fn(),
    db: { team: { findFirst: findTeam, count: countTeams, update: updateTeam } },
  };
});

vi.mock("@/lib/session", () => ({
  requireAccess: mocks.requireAccess,
  isStudio: (u: { role: string }) => u.role === "studio",
  teamScope: () => ({}),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { ...mocks.db, $transaction: mocks.transaction },
}));

vi.mock("@/lib/wave-schedule-db", () => ({ scheduleTransaction: mocks.transaction }));

vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: mocks.revalidate }));
vi.mock("@/lib/access", () => ({ can: () => true }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(), AUDIT: new Proxy({}, { get: () => "x" }) }));

// Imported AFTER the mocks, the way every action test in this project does it.
const { setTeamStation } = await import("@/lib/actions/teams");

/** A team standing on station 2 of a pending wave that runs `capacity` rigs. */
function seatedIn(capacity: number, station: number | null = 2) {
  return {
    id: "t1",
    seriesId: "s1",
    waveId: "w1",
    station,
    waveRef: { status: "pending", capacity },
  };
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a test whose action never reaches the
  // database leaves its mockResolvedValueOnce sitting in the queue, and the
  // NEXT test silently consumes it. That is how this file first went green
  // on the wrong data.
  vi.resetAllMocks();
  mocks.requireAccess.mockResolvedValue({ id: "u1", role: "admin", viewAs: null });
  mocks.findOccupant.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async (_seriesId, work) => work({ team: {
    ...mocks.db.team,
    findFirst: (args: { where: { station?: number } }) => args.where.station === undefined ? mocks.findTeam(args) : mocks.findOccupant(args),
  } }));
});

describe("setTeamStation", () => {
  it("places a team on a station the wave actually runs", async () => {
    mocks.findTeam.mockResolvedValue(seatedIn(7));

    const result = await setTeamStation({ teamId: "t1", station: 7 });

    expect(result.ok).toBe(true);
    expect(mocks.transaction).toHaveBeenCalled();
  });

  // THE ONE THAT MATTERS. Capacity seven, station eight: there is no eighth
  // rig. Auto-placement already refuses this; a hand-typed number must too.
  it("refuses a station past the wave's capacity", async () => {
    mocks.findTeam.mockResolvedValue(seatedIn(7));

    const result = await setTeamStation({ teamId: "t1", station: 8 });

    expect(result).toEqual({ ok: false, error: "BEYOND_CAPACITY" });
    // Refused BEFORE anything is written — not written and then undone.
    expect(mocks.updateTeam).not.toHaveBeenCalled();
  });

  // Its own code, so the screen can name the real number. "INVALID_INPUT"
  // renders as "something went wrong", which sends somebody to re-type the
  // same station and get the same nothing.
  it("says why, rather than failing as invalid input", async () => {
    mocks.findTeam.mockResolvedValue(seatedIn(7));

    const result = await setTeamStation({ teamId: "t1", station: 9 });

    // ActionResult is a union, so narrow before reading the code — and a
    // success here would be the bug this test exists for.
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("station 9 was accepted on a wave of seven");
    expect(result.error).not.toBe("INVALID_INPUT");
    expect(result.error).toBe("BEYOND_CAPACITY");
  });

  // The floor has nine rigs. Capacity is a per-wave dial under that, never
  // above it, so this stays refused by the schema whatever a wave says.
  it("still refuses a station past the nine that exist", async () => {
    mocks.findTeam.mockResolvedValue(seatedIn(9));

    const result = await setTeamStation({ teamId: "t1", station: 10 });

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(mocks.findTeam).not.toHaveBeenCalled();
  });

  it("leaves a wave that has already started alone", async () => {
    mocks.findTeam.mockResolvedValue({
      ...seatedIn(7),
      waveRef: { status: "running", capacity: 7 },
    });

    const result = await setTeamStation({ teamId: "t1", station: 3 });

    expect(result).toEqual({ ok: false, error: "WAVE_STARTED" });
  });
});
