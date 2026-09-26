import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), requireAccess: vi.fn(), requireAnyAccess: vi.fn(), requireUser: vi.fn(), findTeam: vi.fn(), updateTeam: vi.fn(),
  updateScore: vi.fn(), scoreAudit: vi.fn(), transaction: vi.fn(), zoneScores: vi.fn(),
  audit: vi.fn(), revalidate: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireRole: mocks.requireRole,
  requireAccess: mocks.requireAccess,
  requireAnyAccess: mocks.requireAnyAccess,
  requireUser: mocks.requireUser,
  canWriteScore: vi.fn(),
  can: (user: { role: string }) => user.role === "admin",
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  team: { findUnique: mocks.findTeam, update: mocks.updateTeam },
  score: { update: mocks.updateScore }, scoreAudit: { create: mocks.scoreAudit },
  zoneScore: { updateMany: mocks.zoneScores },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.audit, AUDIT: {} }));
vi.mock("@/lib/queries", () => ({ getSeriesZones: vi.fn() }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: mocks.revalidate }));

import { setAttendance, setPayment } from "@/lib/actions/payments";
import { unlockScore } from "@/lib/actions/scores";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue({ id: "admin" });
  mocks.requireAccess.mockResolvedValue({ id: "admin", role: "admin" });
  mocks.requireAnyAccess.mockResolvedValue({ id: "admin", role: "admin" });
  mocks.requireUser.mockResolvedValue({ id: "admin", role: "admin" });
  mocks.findTeam.mockResolvedValue({ id: "team", seriesId: "database-id-not-a-slug", number: 101, name: "TEAM", paymentStatus: "pending", score: { id: "score" } });
  mocks.transaction.mockImplementation(async (writes: Promise<unknown>[]) => Promise.all(writes));
});

describe("prefetched competition data after writes", () => {
  it.each([
    ["payment", () => setPayment({ teamId: "team", status: "paid" })],
    ["attendance", () => setAttendance({ teamId: "team", attended: true })],
    ["score correction", () => unlockScore("team")],
  ] as const)("invalidates dependent role views only after %s is stored and audited", async (_name, mutate) => {
    const events: string[] = [];
    mocks.updateTeam.mockImplementation(async () => { events.push("write"); });
    // Unlocking writes the score row itself (no studio edit budget to reset any more).
    mocks.updateScore.mockImplementation(async () => { events.push("write"); });
    mocks.audit.mockImplementation(async () => { events.push("audit"); });
    mocks.revalidate.mockImplementation(() => { events.push("invalidate"); });
    expect(await mutate()).toEqual({ ok: true });
    expect(events).toEqual(["write", "audit", "invalidate"]);
    if (_name === "score correction") expect(mocks.requireUser).toHaveBeenCalled();
    // Check-in is the Organiser's floor key, or payment for whoever holds that.
    else if (_name === "attendance") expect(mocks.requireAnyAccess).toHaveBeenCalledWith(["registrations.attendance", "registrations.payment"]);
    else expect(mocks.requireAccess).toHaveBeenCalledWith("registrations.payment");
  });

  it("does not mark data fresh or report success when storage fails", async () => {
    mocks.updateTeam.mockRejectedValue(new Error("storage unavailable"));
    await expect(setPayment({ teamId: "team", status: "paid" })).rejects.toThrow("storage unavailable");
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("keeps rejected inputs and absent teams out of the write and invalidation path", async () => {
    expect(await setAttendance({ teamId: "team", attended: "yes" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    mocks.findTeam.mockResolvedValue(null);
    expect(await setPayment({ teamId: "missing", status: "paid" })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(mocks.updateTeam).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
