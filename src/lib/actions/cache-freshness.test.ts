import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), requireAccess: vi.fn(), requireAnyAccess: vi.fn(), requireUser: vi.fn(), getCurrentUser: vi.fn(), findTeam: vi.fn(), updateTeam: vi.fn(),
  updateScore: vi.fn(), scoreAudit: vi.fn(), transaction: vi.fn(), zoneScores: vi.fn(),
  audit: vi.fn(), revalidate: vi.fn(), updateSeats: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireRole: mocks.requireRole,
  requireAccess: mocks.requireAccess,
  requireAnyAccess: mocks.requireAnyAccess,
  requireUser: mocks.requireUser,
  getCurrentUser: mocks.getCurrentUser,
  canWriteScore: vi.fn(),
  can: (user: { role: string }) => user.role === "admin",
  canAny: (user: { role: string }) => user.role === "admin",
  teamScope: () => ({}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  team: { findUnique: mocks.findTeam, findFirst: mocks.findTeam, update: mocks.updateTeam },
  // Check-in writes each seat and the team together, under a lock on the team row,
  // after reading the seats and the competition's waiver (none here), with a
  // history row per athlete.
  competitor: {
    updateMany: mocks.updateSeats,
    findMany: vi.fn(async () => [{ id: "seat", attendedAt: null, teamId: "team", fullName: "A", userId: null, dateOfBirth: null, team: { category: "Mens" }, user: null }]),
  },
  $queryRaw: vi.fn(),
  waiverRelease: { findFirst: vi.fn(async () => null) },
  attendanceEvent: { createMany: vi.fn() },
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
  mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin" });
  mocks.findTeam.mockResolvedValue({ id: "team", seriesId: "database-id-not-a-slug", number: 101, name: "TEAM", paymentStatus: "pending", score: { id: "score" }, attendedAt: null, archivedAt: null, waitlistedAt: null, waveId: null, warmupReadyAt: null, warmupWaveId: null, series: { status: "live", archivedAt: null }, competitors: [{ id: "seat", attendedAt: null }] });
  // Both forms: a list of writes (scores), or a callback given the client (check-in).
  mocks.transaction.mockImplementation(async (work: Promise<unknown>[] | ((tx: unknown) => unknown)) =>
    typeof work === "function" ? work((await import("@/lib/prisma")).prisma) : Promise.all(work));
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
    // Check-in answers a refusal rather than redirecting (it is pressed from
    // the marshalling screen), so it reads the user and checks the keys itself.
    else if (_name === "attendance") expect(mocks.getCurrentUser).toHaveBeenCalled();
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
