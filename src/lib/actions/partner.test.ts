/**
 * An athlete changing who their partner is.
 *
 * What is pinned here is the BOUNDARY, not the mechanics. An athlete may undo a
 * pair right up until their competition's own cutoff — and not at all once the
 * pair has been entered as a team, because from then on it is a wave, a station
 * and possibly a payment, and that is staff's to move (`team-swap.ts`).
 *
 * Also pinned: the race guard. Two taps arriving together must not leave one
 * side pointing at somebody who is no longer pointing back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const findProfile = vi.fn();
  const updateProfiles = vi.fn();
  return {
    resolve: vi.fn(),
    requireRole: vi.fn(),
    can: vi.fn(),
    checkRate: vi.fn(),
    findProfile,
    updateProfiles,
    findCompetitor: vi.fn(),
    findUser: vi.fn(),
    transaction: vi.fn(),
    unlinkPair: vi.fn(),
    teamEditOpen: vi.fn(),
    email: vi.fn(),
    audit: vi.fn(),
    revalidate: vi.fn(),
    tx: { $queryRaw: vi.fn(), competitor: { findFirst: vi.fn().mockResolvedValue(null) }, seriesParticipant: { updateMany: updateProfiles } },
  };
});

vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/access", () => ({ can: mocks.can }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    seriesParticipant: {
      findUnique: mocks.findProfile,
      updateMany: mocks.updateProfiles,
      upsert: vi.fn(),
    },
    competitor: { findFirst: mocks.findCompetitor },
    user: { findUnique: mocks.findUser },
    partnerRequest: { updateMany: vi.fn() },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/partners", () => ({ unlinkPair: mocks.unlinkPair, onAthleteVerified: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRate: mocks.checkRate, MINUTE_MS: 60_000 }));
vi.mock("@/lib/visibility", () => ({ teamEditOpen: mocks.teamEditOpen }));
vi.mock("@/lib/email", () => ({ sendPartnerUnlinkedEmail: mocks.email }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.audit, AUDIT: { partnerUnlinked: "unlink" } }));
vi.mock("@/lib/security", () => ({
  getBaseUrl: () => "https://podium.test",
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
  isValidEmail: () => true,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

vi.mock("@/lib/participation", () => ({ resolveMySeries: mocks.resolve, meHref: (id: string) => "/me?series=" + id }));

import { unlinkPartner } from "@/lib/actions/partner";

const athlete = { id: "u-sara", name: "Sara Ali", email: "sara@example.com", role: "competitor" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ id: "series-1", competitionDate: new Date("2026-11-01"), teamEditCloseHours: 24 });
  mocks.requireRole.mockResolvedValue(athlete);
  mocks.can.mockReturnValue(true);
  mocks.checkRate.mockReturnValue({ ok: true });
  mocks.findProfile.mockResolvedValue({ partnerUserId: "u-mona" });
  mocks.findCompetitor.mockResolvedValue(null);
  mocks.findUser.mockResolvedValue({
    email: "mona@example.com",
    requestedSeries: { competitionDate: new Date("2026-11-01"), teamEditCloseHours: 24 },
  });
  mocks.teamEditOpen.mockReturnValue({ open: true });
  mocks.updateProfiles.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mocks.tx));
});

describe("who may", () => {
  it("refuses a read-only stand-in", async () => {
    mocks.requireRole.mockResolvedValue({ ...athlete, viewAs: "someone" });
    expect(await unlinkPartner("series-1")).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuses somebody without partner.edit", async () => {
    mocks.can.mockReturnValue(false);
    expect(await unlinkPartner("series-1")).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("throttles it — this sends somebody else an email", async () => {
    mocks.checkRate.mockReturnValue({ ok: false });
    expect(await unlinkPartner("series-1")).toEqual({ ok: false, error: "TRY_LATER" });
  });

  it("does nothing when there is no partner", async () => {
    mocks.findProfile.mockResolvedValue({ partnerUserId: null });
    expect(await unlinkPartner("series-1")).toEqual({ ok: false, error: "NOT_LINKED" });
  });
});

describe("the doors", () => {
  it("hands an entered pair to staff instead", async () => {
    mocks.findCompetitor.mockResolvedValue({ id: "c1" });
    expect(await unlinkPartner("series-1")).toEqual({ ok: false, error: "TEAM_REGISTERED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("shuts at the competition's own cutoff", async () => {
    mocks.teamEditOpen.mockReturnValue({ open: false, reason: "TEAM_EDIT_CLOSED" });
    expect(await unlinkPartner("series-1")).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
  });

  it("uses the selected competition cutoff even when the legacy choice is empty", async () => {
    mocks.findUser.mockResolvedValue({ email: "mona@example.com", requestedSeries: null });
    expect(await unlinkPartner("series-1")).toEqual({ ok: true });
    expect(mocks.teamEditOpen).toHaveBeenCalled();
  });
});

describe("unlinking", () => {
  it("clears both sides inside one transaction", async () => {
    expect(await unlinkPartner("series-1")).toEqual({ ok: true });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.unlinkPair).toHaveBeenCalledWith("u-sara", "u-mona", "series-1", mocks.tx);
  });

  it("claims the link conditionally, so two taps cannot half-run it", async () => {
    expect(mocks.updateProfiles).not.toHaveBeenCalled();
    await unlinkPartner("series-1");
    expect(mocks.updateProfiles).toHaveBeenCalledWith({
      where: { seriesId: "series-1", userId: "u-sara", partnerUserId: "u-mona" },
      data: { partnerUserId: null },
    });
  });

  it("loses the race gracefully when somebody else got there first", async () => {
    mocks.updateProfiles.mockResolvedValue({ count: 0 });
    expect(await unlinkPartner("series-1")).toEqual({ ok: false, error: "NOT_LINKED" });
    expect(mocks.unlinkPair).not.toHaveBeenCalled();
  });

  it("tells the other person — nobody should find out by opening the app", async () => {
    await unlinkPartner("series-1");
    expect(mocks.email).toHaveBeenCalledWith(
      expect.objectContaining({ email: "mona@example.com", byName: "Sara Ali" })
    );
  });

  it("still stands when the email does not go out", async () => {
    mocks.email.mockRejectedValue(new Error("smtp down"));
    expect(await unlinkPartner("series-1")).toEqual({ ok: true });
    expect(mocks.audit).toHaveBeenCalled();
  });
});
