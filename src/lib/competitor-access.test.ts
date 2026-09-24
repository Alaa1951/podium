/**
 * Letting a competitor in — the door that carries automatic approval with it.
 *
 * This file had no tests at all, and it is the most consequential gate in the
 * system: `accountForCompetitor` silently flips an account to `approved`, on
 * the reasoning that somebody who registered AND paid has already been
 * decided about. That reasoning holds for a place in the field. It does NOT
 * hold for the waiting list, where money arrives from people nobody has let
 * in yet — and without the guard below, paying would be how you approve
 * yourself and walk into a full competition.
 *
 * So the load-bearing test here is the paid-but-waiting one. Everything else
 * is the surrounding contract: silence about who has ever competed, and a
 * signed-up athlete still reaching their own account.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findCompetitors: vi.fn(),
  findUser: vi.fn(),
  updateUser: vi.fn(),
  createUser: vi.fn(),
  linkCompetitors: vi.fn(),
  otp: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    seriesParticipant: { upsert: vi.fn() },
    competitor: { findMany: mocks.findCompetitors, updateMany: mocks.linkCompetitors },
    user: { findUnique: mocks.findUser, update: mocks.updateUser, create: mocks.createUser },
  },
}));
vi.mock("@/lib/otp", () => ({ createOtpChallenge: mocks.otp }));
vi.mock("@/lib/security", () => ({ normalizeEmail: (e: string) => e.trim().toLowerCase() }));

import { issueCompetitorCode } from "@/lib/competitor-access";

const WAITING = new Date("2026-09-21T10:00:00Z");

/** One registration of Sara's, with the team facts the gate reads. */
function entry(team: { paymentStatus: string; waitlistedAt?: Date | null }) {
  return {
    id: "c1",
    fullName: "Sara Ali",
    userId: null,
    team: {
      id: "t1",
      seriesId: "s1",
      name: "FALCONS",
      paymentStatus: team.paymentStatus,
      waitlistedAt: team.waitlistedAt ?? null,
      series: { id: "s1", name: "PODIUM 4", slug: "podium-4", status: "scheduled" },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.otp.mockResolvedValue({ code: "123456" });
  mocks.linkCompetitors.mockResolvedValue({ count: 1 });
  mocks.findUser.mockResolvedValue(null);
  mocks.createUser.mockResolvedValue({ id: "u-sara", email: "sara@example.com" });
});

describe("a place in the field", () => {
  it("lets a paid competitor in, and makes them an account on the way through", async () => {
    mocks.findCompetitors.mockResolvedValue([entry({ paymentStatus: "paid" })]);
    expect(await issueCompetitorCode("Sara@Example.com")).toEqual({
      ok: true,
      code: "123456",
      name: "Sara Ali",
    });
    expect(mocks.createUser).toHaveBeenCalled();
  });

  it("approves a waiting account that has paid — the rule this door exists for", async () => {
    mocks.findCompetitors.mockResolvedValue([entry({ paymentStatus: "paid" })]);
    mocks.findUser.mockResolvedValue({
      id: "u-sara",
      role: "competitor",
      status: "active",
      approvalStatus: "pending",
    });
    mocks.updateUser.mockResolvedValue({ id: "u-sara" });

    await issueCompetitorCode("sara@example.com");
    expect(mocks.updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ approvalStatus: "approved" }) })
    );
  });
});

describe("training payments", () => {
  it("never upgrades account approval because a rehearsal team is marked paid", async () => {
    const rehearsal = entry({ paymentStatus: "paid" });
    mocks.findCompetitors.mockResolvedValue([{ ...rehearsal, team: { ...rehearsal.team, series: { ...rehearsal.team.series, isTraining: true } } }]);
    mocks.findUser.mockResolvedValue({ id: "u-sara", name: "Sara", role: "competitor", status: "active", signupType: "athlete", approvalStatus: "pending" });
    expect(await issueCompetitorCode("sara@example.com")).toMatchObject({ ok: true });
    expect(mocks.updateUser).not.toHaveBeenCalled(); expect(mocks.createUser).not.toHaveBeenCalled();
  });
});

describe("shared contact email on imported rosters", () => {
  it("does not turn different athletes sharing one event email into one account", async () => {
    const first = entry({ paymentStatus: "paid" });
    mocks.findCompetitors.mockResolvedValue([first, { ...first, id: "c2", fullName: "Another athlete" }]);
    expect(await issueCompetitorCode("shared@example.com")).toEqual({ ok: false });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.linkCompetitors).not.toHaveBeenCalled();
  });
  it("links the same account across events but leaves an ambiguous event unclaimed", async () => {
    const first = entry({ paymentStatus: "paid" });
    const next = { ...first, id: "c-next", team: { ...first.team, seriesId: "s2", series: { ...first.team.series, id: "s2" } } };
    mocks.findCompetitors.mockResolvedValue([first, { ...first, id: "c2" }, next]);
    expect(await issueCompetitorCode("sara@example.com")).toMatchObject({ ok: true });
    expect(mocks.linkCompetitors).toHaveBeenCalledTimes(1);
    expect(mocks.linkCompetitors).toHaveBeenCalledWith({ where: { id: "c-next", email: "sara@example.com", userId: null }, data: { userId: "u-sara" } });
  });
});

describe("the waiting list", () => {
  it("does NOT treat a paid waitlisted entry as a competitor", async () => {
    // The whole point: money must not be how somebody joins a full
    // competition. They fall through to the signed-up-athlete door instead,
    // which issues a code WITHOUT approving anybody.
    mocks.findCompetitors.mockResolvedValue([
      entry({ paymentStatus: "paid", waitlistedAt: WAITING }),
    ]);
    mocks.findUser.mockResolvedValue({
      id: "u-sara",
      name: "Sara Ali",
      role: "competitor",
      status: "active",
      signupType: "athlete",
    });

    const result = await issueCompetitorCode("sara@example.com");

    // They still reach their own account — they are not locked out.
    expect(result).toEqual({ ok: true, code: "123456", name: "Sara Ali" });
    // But nothing approved them, and no account was minted for them.
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("picks the entry that holds a place when somebody has both", async () => {
    mocks.findCompetitors.mockResolvedValue([
      entry({ paymentStatus: "paid", waitlistedAt: WAITING }),
      entry({ paymentStatus: "paid" }),
    ]);
    expect(await issueCompetitorCode("sara@example.com")).toMatchObject({ ok: true });
    expect(mocks.createUser).toHaveBeenCalled();
  });
});

describe("what a stranger learns", () => {
  it("says nothing at all for an address that never competed and never signed up", async () => {
    mocks.findCompetitors.mockResolvedValue([]);
    mocks.findUser.mockResolvedValue(null);
    expect(await issueCompetitorCode("nobody@example.com")).toEqual({ ok: false });
  });

  it("refuses a disabled account rather than mailing it a code", async () => {
    mocks.findCompetitors.mockResolvedValue([entry({ paymentStatus: "paid" })]);
    mocks.findUser.mockResolvedValue({
      id: "u-sara",
      role: "competitor",
      status: "disabled",
      approvalStatus: "approved",
    });
    expect(await issueCompetitorCode("sara@example.com")).toEqual({ ok: false });
    expect(mocks.otp).not.toHaveBeenCalled();
  });

  it("does not let an unpaid registration alone be a way in", async () => {
    mocks.findCompetitors.mockResolvedValue([entry({ paymentStatus: "pending" })]);
    mocks.findUser.mockResolvedValue(null);
    expect(await issueCompetitorCode("sara@example.com")).toEqual({ ok: false });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});
