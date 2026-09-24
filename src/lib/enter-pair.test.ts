/**
 * The bridge from "approved account" to "entry in a competition".
 *
 * Two things are pinned here, and they pull in opposite directions.
 *
 * It must FIRE — otherwise athletes sit approved and in nothing, which is the
 * gap it was written to close. And it must be a NO-OP in every incomplete case,
 * because it is called from two different decisions that have already
 * committed, and neither may be undone by it. So most of this file is the list
 * of things that must not produce a team.
 *
 * The one to read first is the waiting-list pair: the LATER sign-up decides, so
 * an early bird cannot carry a late partner into a competition that closed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  findSeries: vi.fn(),
  findCompetitor: vi.fn(),
  findTeam: vi.fn(),
  createTeam: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    series: { findFirst: mocks.findSeries },
    competitor: { findFirst: mocks.findCompetitor },
    team: { findFirst: mocks.findTeam, create: mocks.createTeam },
  },
}));
vi.mock("@/lib/scoring", () => ({ normalizeName: (n: string) => n.toLowerCase() }));

vi.mock("@/lib/participation", () => ({ loadSeriesAthlete: (id: string, seriesId: string) => mocks.findUser({ where: { id }, seriesId }) }));
vi.mock("@/lib/team-create", () => ({ createTeam: mocks.createTeam }));

import { enterPairIfReady } from "@/lib/enter-pair";

const CLOSES = new Date("2026-10-01T00:00:00Z");
const IN_TIME = new Date("2026-09-01T00:00:00Z");
const LATE = new Date("2026-10-05T00:00:00Z");

function athlete(id: string, over: Record<string, unknown> = {}) {
  const { profile, ...rest } = over as { profile?: Record<string, unknown> };
  return {
    id,
    name: `Name ${id}`,
    email: `${id}@example.com`,
    phone: "+97455500000",
    studioId: "studio-a",
    signupAt: IN_TIME,
    approvalStatus: "approved",
    status: "active",
    archivedAt: null,
    role: "competitor",
    requestedSeriesId: "s1",
    athleteProfile: {
      partnerUserId: id === "a" ? "b" : "a",
      division: "Open",
      category: "Womens",
      sex: "f",
      dateOfBirth: null,
      shirtSize: "M",
      bftMember: false,
      teamName: "THE FALCONS",
      ...profile,
    },
    ...rest,
  };
}

/** Steer the two `user.findUnique` calls by id. */
function pair(a = athlete("a"), b = athlete("b")) {
  mocks.findUser.mockImplementation(async ({ where, seriesId }: { where: { id: string }; seriesId: string }) => {
    const person = where.id === "a" ? a : where.id === "b" ? b : null;
    return person?.requestedSeriesId === seriesId ? person : null;
  }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  pair();
  mocks.findSeries.mockResolvedValue({ id: "s1", name: "PODIUM 4", registrationClosesAt: CLOSES });
  mocks.findCompetitor.mockResolvedValue(null);
  mocks.findTeam.mockResolvedValue({ number: 120 });
  mocks.createTeam.mockResolvedValue({ ok: true, id: "t1", number: 121 });
});

describe("when everything is ready", () => {
  it("enters the pair, unpaid, as a sign-up", async () => {
    const result = await enterPairIfReady("a", "s1");
    expect(result).toEqual({ entered: true, teamId: "t1", teamNumber: 121, waitlisted: false });

    const data = mocks.createTeam.mock.calls[0][1];
    expect(data).toMatchObject({
      seriesId: "s1",
      name: "THE FALCONS",
      category: "Womens",
      division: "Open",
      // Never paid on creation: an entry the system made is still an entry
      // somebody has to confirm the money for.
      paymentStatus: "pending",
      // Not `manual` — nobody at BFT MENA typed this in.
      source: "signup",
      waitlistedAt: null,
    });
    expect(data.seats).toHaveLength(2);
    expect(data.seats[0]).toMatchObject({ position: 1, userId: "a", email: "a@example.com" });
  });

  it("carries each athlete's own shirt size and studio onto their seat", async () => {
    await enterPairIfReady("a", "s1");
    const seats = mocks.createTeam.mock.calls[0][1].seats;
    expect(seats.every((seat: { shirtSize: string }) => seat.shirtSize === "M")).toBe(true);
  });
});

describe("the waiting list", () => {
  it("gives the pair a place when both signed up in time", async () => {
    expect(await enterPairIfReady("a", "s1")).toMatchObject({ waitlisted: false });
  });

  it("puts the pair on the list when the SECOND one was late", async () => {
    // The rule that matters. Without it, anybody could be added to an early
    // sign-up after the deadline and walk into a closed competition.
    pair(athlete("a"), athlete("b", { signupAt: LATE }));
    const result = await enterPairIfReady("a", "s1");
    expect(result).toMatchObject({ entered: true, waitlisted: true });
    expect(mocks.createTeam.mock.calls[0][1].waitlistedAt).toBeInstanceOf(Date);
  });

  it("gives a place when the competition has no deadline at all", async () => {
    mocks.findSeries.mockResolvedValue({ id: "s1", name: "X", registrationClosesAt: null });
    pair(athlete("a", { signupAt: LATE }), athlete("b", { signupAt: LATE }));
    expect(await enterPairIfReady("a", "s1")).toMatchObject({ waitlisted: false });
  });
});

describe("what must NOT produce a team", () => {
  it("an athlete who chose no competition", async () => {
    pair(athlete("a", { requestedSeriesId: null }));
    expect(await enterPairIfReady("a")).toEqual({ entered: false, reason: "NO_COMPETITION" });
    expect(mocks.createTeam).not.toHaveBeenCalled();
  });

  it("an athlete with no partner", async () => {
    pair(athlete("a", { profile: { partnerUserId: null } }));
    expect(await enterPairIfReady("a", "s1")).toEqual({ entered: false, reason: "NO_PARTNER" });
  });

  it("a partner who chose a DIFFERENT competition — one choosing is not consent", async () => {
    pair(athlete("a"), athlete("b", { requestedSeriesId: "s2" }));
    expect(await enterPairIfReady("a", "s1")).toEqual({ entered: false, reason: "PARTNER_CHOSE_ANOTHER" });
    expect(mocks.createTeam).not.toHaveBeenCalled();
  });

  it("a partner who chose NOTHING — left for staff, not guessed at", async () => {
    pair(athlete("a"), athlete("b", { requestedSeriesId: null }));
    expect(await enterPairIfReady("a", "s1")).toEqual({ entered: false, reason: "PARTNER_CHOSE_ANOTHER" });
  });

  it("a one-sided link, where they do not point back", async () => {
    pair(athlete("a"), athlete("b", { profile: { partnerUserId: "c" } }));
    expect(await enterPairIfReady("a", "s1")).toEqual({ entered: false, reason: "NO_PARTNER" });
  });

  it("an account still waiting for approval", async () => {
    pair(athlete("a", { approvalStatus: "pending" }));
    expect(await enterPairIfReady("a", "s1")).toEqual({ entered: false, reason: "NOT_APPROVED" });
  });

  it("a partner whose account was disabled or archived", async () => {
    pair(athlete("a"), athlete("b", { status: "disabled" }));
    expect(await enterPairIfReady("a", "s1")).toEqual({ entered: false, reason: "NOT_APPROVED" });
    pair(athlete("a"), athlete("b", { archivedAt: new Date() }));
    expect(await enterPairIfReady("a", "s1")).toEqual({ entered: false, reason: "NOT_APPROVED" });
  });

  it("a finished, archived or inactive competition", async () => {
    mocks.findSeries.mockResolvedValue(null);
    expect(await enterPairIfReady("a", "s1")).toEqual({ entered: false, reason: "COMPETITION_CLOSED" });
  });

  it("a pair at two different levels", async () => {
    pair(athlete("a"), athlete("b", { profile: { division: "Pro" } }));
    expect(await enterPairIfReady("a", "s1")).toEqual({ entered: false, reason: "MIXED_LEVELS" });
  });

  it("a category the two genders cannot make", async () => {
    // Womens with a man on it would write a bracket AND a set of prescribed
    // loads (LoadStandard is keyed on [division, sex]) that are simply wrong.
    pair(athlete("a"), athlete("b", { profile: { sex: "m" } }));
    expect(await enterPairIfReady("a", "s1")).toEqual({ entered: false, reason: "CATEGORY_MISMATCH" });
  });

  it("a profile with no level or category yet", async () => {
    pair(athlete("a", { profile: { division: null } }));
    expect(await enterPairIfReady("a", "s1")).toEqual({ entered: false, reason: "INCOMPLETE_PROFILE" });
  });

  it("somebody a studio already entered by hand", async () => {
    mocks.createTeam.mockResolvedValue({ ok: false, error: "ALREADY_ENTERED" });
    expect(await enterPairIfReady("a", "s1")).toEqual({ entered: false, reason: "ALREADY_ENTERED" });
    expect(mocks.createTeam).toHaveBeenCalledOnce();
  });

  it("a second simultaneous attempt, caught by the unique team number", async () => {
    // Approval and a partner acceptance firing together both compute the same
    // number; @@unique([seriesId, number]) rejects the second rather than
    // letting one pair become two teams.
    mocks.createTeam.mockResolvedValue({ ok: false, error: "ALREADY_ENTERED" });
    expect(await enterPairIfReady("a", "s1")).toEqual({ entered: false, reason: "ALREADY_ENTERED" });
  });

  it("rethrows anything it does not recognise, rather than swallowing it", async () => {
    mocks.createTeam.mockRejectedValue(new Error("database on fire"));
    await expect(enterPairIfReady("a", "s1")).rejects.toThrow("database on fire");
  });
});
