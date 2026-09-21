/**
 * Admitting from the waiting list, and putting somebody back.
 *
 * The rule BFT MENA asked for is a NEGATIVE one — money must not buy a place —
 * and a negative rule is only kept if something checks that the code never
 * quietly starts honouring it. So the load-bearing test here asserts what this
 * action does NOT do: it never reads and never writes `paymentStatus`.
 *
 * The rest pins the guards: a finished competition cannot have its field
 * re-decided, a scored team cannot be sent back to the queue, and two people
 * pressing at once do not both get told it worked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  findTeam: vi.fn(),
  updateTeams: vi.fn(),
  email: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAccess: mocks.requireAccess,
  teamScope: () => ({}),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { team: { findFirst: mocks.findTeam, updateMany: mocks.updateTeams } },
}));
vi.mock("@/lib/email", () => ({ sendWaitlistDecisionEmail: mocks.email }));
vi.mock("@/lib/audit", () => ({
  recordAudit: mocks.audit,
  AUDIT: { waitlistAdmitted: "in", waitlistReturned: "out" },
}));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: mocks.revalidate }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/security", () => ({ getBaseUrl: () => "https://podium.test" }));

import { setWaitlist } from "@/lib/actions/waitlist";

const staff = { id: "admin-1", role: "admin", studioId: null, email: "hq@example.com" };
const WAITING = new Date("2026-09-21T10:00:00Z");

function team(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    number: 121,
    name: "FALCONS",
    waitlistedAt: WAITING,
    score: null,
    series: { name: "PODIUM 4", slug: "podium-4", status: "scheduled" },
    competitors: [{ email: "a@example.com" }, { email: "b@example.com" }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(staff);
  mocks.findTeam.mockResolvedValue(team());
  mocks.updateTeams.mockResolvedValue({ count: 1 });
});

describe("money buys nothing", () => {
  it("never reads or writes paymentStatus", async () => {
    // The rule is negative, so this is the test that keeps it. If admitting
    // somebody ever starts touching the money — or refusing to admit an unpaid
    // entry — that is the feature quietly inverting itself.
    await setWaitlist({ teamId: "t1", waiting: false });

    const select = JSON.stringify(mocks.findTeam.mock.calls[0][0].select);
    expect(select).not.toContain("paymentStatus");

    const written = JSON.stringify(mocks.updateTeams.mock.calls[0][0].data);
    expect(written).not.toContain("payment");
    expect(written).not.toContain("paidAt");
  });

  it("admits an entry that has never paid, without comment", async () => {
    expect(await setWaitlist({ teamId: "t1", waiting: false })).toMatchObject({ ok: true });
    expect(mocks.updateTeams).toHaveBeenCalledWith({
      where: { id: "t1", waitlistedAt: { not: null } },
      data: { waitlistedAt: null },
    });
  });
});

describe("who may", () => {
  it("asks for its own permission, not the payment one", async () => {
    await setWaitlist({ teamId: "t1", waiting: false });
    expect(mocks.requireAccess).toHaveBeenCalledWith("registrations.waitlist");
  });

  it("refuses a read-only stand-in", async () => {
    mocks.requireAccess.mockResolvedValue({ ...staff, viewAs: "someone" });
    expect(await setWaitlist({ teamId: "t1", waiting: false })).toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
    expect(mocks.updateTeams).not.toHaveBeenCalled();
  });

  it("reads a team outside the actor's reach as not found", async () => {
    mocks.findTeam.mockResolvedValue(null);
    expect(await setWaitlist({ teamId: "t1", waiting: false })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });
});

describe("the guards", () => {
  it("will not re-decide the field of a finished competition", async () => {
    mocks.findTeam.mockResolvedValue(team({ series: { name: "X", slug: "x", status: "final" } }));
    expect(await setWaitlist({ teamId: "t1", waiting: false })).toEqual({
      ok: false,
      error: "SERIES_FINISHED",
    });
  });

  it("will not send a SCORED team back to the queue", async () => {
    mocks.findTeam.mockResolvedValue(team({ waitlistedAt: null, score: { id: "sc1" } }));
    expect(await setWaitlist({ teamId: "t1", waiting: true })).toEqual({
      ok: false,
      error: "TEAM_ALREADY_SCORED",
    });
  });

  it("still admits a scored team — that direction takes nothing away", async () => {
    mocks.findTeam.mockResolvedValue(team({ score: { id: "sc1" } }));
    expect(await setWaitlist({ teamId: "t1", waiting: false })).toMatchObject({ ok: true });
  });

  it("tells the loser of a race, rather than both of them it worked", async () => {
    mocks.updateTeams.mockResolvedValue({ count: 0 });
    expect(await setWaitlist({ teamId: "t1", waiting: false })).toEqual({
      ok: false,
      error: "ALREADY_ADMITTED",
    });
    expect(await setWaitlist({ teamId: "t1", waiting: true })).toEqual({
      ok: false,
      error: "ALREADY_WAITING",
    });
  });
});

describe("telling them", () => {
  it("emails BOTH people on the team, not whoever registered it", async () => {
    await setWaitlist({ teamId: "t1", waiting: false });
    expect(mocks.email).toHaveBeenCalledTimes(2);
    expect(mocks.email).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@example.com", admitted: true })
    );
    expect(mocks.email).toHaveBeenCalledWith(
      expect.objectContaining({ email: "b@example.com", admitted: true })
    );
  });

  it("still reaches the second person when the first address fails", async () => {
    mocks.email.mockRejectedValueOnce(new Error("bad address"));
    expect(await setWaitlist({ teamId: "t1", waiting: false })).toMatchObject({ ok: true });
    expect(mocks.email).toHaveBeenCalledTimes(2);
  });

  it("skips a seat with no address at all", async () => {
    mocks.findTeam.mockResolvedValue(team({ competitors: [{ email: null }, { email: "b@example.com" }] }));
    await setWaitlist({ teamId: "t1", waiting: false });
    expect(mocks.email).toHaveBeenCalledTimes(1);
  });

  it("records which way it went", async () => {
    await setWaitlist({ teamId: "t1", waiting: true });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "out" }));
    vi.clearAllMocks();
    mocks.requireAccess.mockResolvedValue(staff);
    mocks.findTeam.mockResolvedValue(team());
    mocks.updateTeams.mockResolvedValue({ count: 1 });
    await setWaitlist({ teamId: "t1", waiting: false });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "in" }));
  });
});
