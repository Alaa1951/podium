/**
 * Swapping somebody on a registered team.
 *
 * This is the most dangerous action in the batch: it changes who stands on a
 * team that may be minutes from the floor. Two things are pinned here.
 *
 * The three doors — a finished competition, a scored team, a wave that has
 * started — because each one exists to stop a different kind of lie, and a
 * refactor that drops one would not fail anywhere else.
 *
 * And the partner link MOVING with the swap. If it does not, `partnerUserId`
 * points at somebody who is not on the team, and `/me` lies to two people at
 * once. Nothing throws when that happens, which is exactly why it is tested.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const requireAccess = vi.fn();
  const findSeat = vi.fn();
  const updateSeat = vi.fn();
  const findUser = vi.fn();
  const countProfiles = vi.fn();
  const cancelRequests = vi.fn();
  const transaction = vi.fn();
  return {
    requireAccess,
    findSeat,
    updateSeat,
    findUser,
    countProfiles,
    cancelRequests,
    transaction,
    linkPair: vi.fn(),
    unlinkPair: vi.fn(),
    audit: vi.fn(),
    revalidate: vi.fn(),
    /** The one client both the action and its transaction callback see. */
    db: {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "s1" }]),
      competitor: { findFirst: findSeat, update: updateSeat },
      user: { findFirst: findUser },
      seriesParticipant: { count: countProfiles },
      partnerRequest: { updateMany: cancelRequests },
    },
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
vi.mock("@/lib/partners", () => ({ linkPair: mocks.linkPair, unlinkPair: mocks.unlinkPair }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.audit, AUDIT: { teamMemberSwapped: "swap" } }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: mocks.revalidate }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/scoring", () => ({ normalizeName: (n: string) => n.toLowerCase() }));
vi.mock("@/lib/security", () => ({
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
  isValidEmail: (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e),
}));

vi.mock("@/lib/participation", () => ({ ensureParticipation: async () => ({ shirtSize: "M", bftMember: false }) }));

import { swapTeamMember } from "@/lib/actions/team-swap";

const staff = { id: "admin-1", role: "admin", studioId: null, email: "hq@example.com" };

/** A seat on a team that is nowhere near the floor: every door open. */
function seat(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    position: 1,
    fullName: "Sara Ali",
    email: "sara@example.com",
    userId: "u-sara",
    team: {
      id: "t1",
      seriesId: "s1",
      number: 101,
      name: "FALCONS",
      waveId: "w1",
      waveRef: { status: "pending" },
      score: null,
      series: { status: "scheduled" },
      competitors: [
        { id: "c1", userId: "u-sara" },
        { id: "c2", userId: "u-mona" },
      ],
      ...over,
    },
  };
}

function substitute() {
  return {
    id: "u-nour",
    name: "Nour Hassan",
    email: "Nour@Example.com",
    phone: "+97455500001",
    studioId: "studio-b",
    athleteProfile: { dateOfBirth: null, shirtSize: "M", bftMember: false, partnerUserId: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(staff);
  mocks.findSeat.mockResolvedValue(seat());
  mocks.findUser.mockResolvedValue(substitute());
  mocks.countProfiles.mockResolvedValue(1);
  // The seat lookup and the "already entered?" lookup share one mock, so the
  // second call is steered per test; by default nobody is entered twice.
  mocks.findSeat.mockImplementation(async (args: { where: { id?: string } }) =>
    args.where.id === "c1" ? seat() : null
  );
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mocks.db));
});

describe("who may do it", () => {
  it("refuses a read-only stand-in", async () => {
    mocks.requireAccess.mockResolvedValue({ ...staff, viewAs: "someone" });
    expect(await swapTeamMember({ competitorId: "c1", replacementUserId: "u-nour" })).toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("asks for a name or an athlete, not nothing", async () => {
    expect(await swapTeamMember({ competitorId: "c1" })).toEqual({ ok: false, error: "NAME_REQUIRED" });
  });
});

describe("the three doors", () => {
  it("is shut on a finished competition", async () => {
    mocks.findSeat.mockResolvedValue(seat({ series: { status: "final" } }));
    expect(await swapTeamMember({ competitorId: "c1", replacementUserId: "u-nour" })).toEqual({
      ok: false,
      error: "SERIES_FINISHED",
    });
  });

  it("is shut on a team that has a score", async () => {
    mocks.findSeat.mockResolvedValue(seat({ score: { id: "sc1" } }));
    expect(await swapTeamMember({ competitorId: "c1", replacementUserId: "u-nour" })).toEqual({
      ok: false,
      error: "TEAM_ALREADY_SCORED",
    });
  });

  it("is shut once the wave is running — the status, not the clock", async () => {
    mocks.findSeat.mockResolvedValue(seat({ waveRef: { status: "running" } }));
    expect(await swapTeamMember({ competitorId: "c1", replacementUserId: "u-nour" })).toEqual({
      ok: false,
      error: "WAVE_STARTED",
    });
  });

  it("stays open for a team with no wave yet — there is nothing to be late for", async () => {
    mocks.findSeat.mockImplementation(async (args: { where: { id?: string } }) =>
      args.where.id === "c1" ? seat({ waveId: null, waveRef: null }) : null
    );
    expect(await swapTeamMember({ competitorId: "c1", replacementUserId: "u-nour" })).toMatchObject({
      ok: true,
    });
  });
});

describe("the swap itself", () => {
  it("edits the seat in place, keeping the team's number, wave and station", async () => {
    await swapTeamMember({ competitorId: "c1", replacementUserId: "u-nour" });

    expect(mocks.updateSeat).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: expect.objectContaining({
        fullName: "Nour Hassan",
        email: "nour@example.com",
        userId: "u-nour",
        shirtSize: "M",
      }),
    });
    // Nothing writes to the team itself: no number, no wave, no station.
    expect(mocks.updateSeat).toHaveBeenCalledTimes(1);
  });

  it("moves the partner link — out with the old, in with the new", async () => {
    await swapTeamMember({ competitorId: "c1", replacementUserId: "u-nour" });

    expect(mocks.unlinkPair).toHaveBeenCalledWith("u-sara", "u-mona", "s1", mocks.db);
    expect(mocks.linkPair).toHaveBeenCalledWith("u-nour", "u-mona", "s1", mocks.db);
  });

  it("does all of it in one transaction — half a swap is worse than none", async () => {
    await swapTeamMember({ competitorId: "c1", replacementUserId: "u-nour" });
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("clears the newcomer's open partner requests — they have one now", async () => {
    await swapTeamMember({ competitorId: "c1", replacementUserId: "u-nour" });
    expect(mocks.cancelRequests).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) })
    );
  });

  it("takes a substitute typed in on the day, with no account at all", async () => {
    const result = await swapTeamMember({
      competitorId: "c1",
      fullName: "  Walk-in Wanda  ",
      phone: "+97455500002",
    });
    expect(result).toMatchObject({ ok: true });
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.updateSeat).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: expect.objectContaining({ fullName: "Walk-in Wanda", userId: null, email: null }),
    });
    // No account means no profile to link, so the remaining member is simply
    // unpaired rather than pointed at somebody who cannot be pointed back.
    expect(mocks.unlinkPair).toHaveBeenCalledWith("u-sara", "u-mona", "s1", mocks.db);
    expect(mocks.linkPair).not.toHaveBeenCalled();
  });

  it("rejects a substitute email that is not one", async () => {
    expect(await swapTeamMember({ competitorId: "c1", fullName: "Walk-in", email: "nope" })).toEqual({
      ok: false,
      error: "EMAIL_INVALID",
    });
  });
});

describe("who cannot be swapped in", () => {
  it("not the other person on the same team", async () => {
    expect(await swapTeamMember({ competitorId: "c1", replacementUserId: "u-mona" })).toEqual({
      ok: false,
      error: "SAME_ATHLETE",
    });
  });

  it("not somebody already entered in this competition", async () => {
    mocks.findSeat.mockImplementation(async (args: { where: { id?: string } }) =>
      args.where.id === "c1" ? seat() : { id: "other-seat" }
    );
    expect(await swapTeamMember({ competitorId: "c1", replacementUserId: "u-nour" })).toEqual({
      ok: false,
      error: "ALREADY_ENTERED",
    });
  });

  it("not an account that is closed, unapproved, or another studio's", async () => {
    mocks.findUser.mockResolvedValue(null);
    expect(await swapTeamMember({ competitorId: "c1", replacementUserId: "u-nour" })).toEqual({
      ok: false,
      error: "ATHLETE_NOT_FOUND",
    });
  });

  it("swapping somebody for themselves changes nothing", async () => {
    expect(await swapTeamMember({ competitorId: "c1", replacementUserId: "u-sara" })).toEqual({ ok: true });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("a seat outside the actor's reach", () => {
  it("reads as not found, never as forbidden", async () => {
    mocks.findSeat.mockResolvedValue(null);
    expect(await swapTeamMember({ competitorId: "c1", replacementUserId: "u-nour" })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });
});
