/**
 * Starting a wave with a team of one athlete (decision D3b): refused, naming
 * the team, once the incomplete-team policy is switched on — and exactly as
 * before while it is off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    wave: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    zone: { count: vi.fn().mockResolvedValue(3) },
  };
  return { tx, user: vi.fn() };
});
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.user, requireAccess: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { wave: { findUnique: vi.fn().mockResolvedValue({ seriesId: "s1" }) }, zoneStaff: { count: vi.fn().mockResolvedValue(0) } } }));
vi.mock("@/lib/wave-schedule-db", () => ({ scheduleTransaction: (_series: string, work: (tx: unknown) => unknown) => work(mocks.tx), waveRowFor: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(), AUDIT: { waveControlled: "wave" } }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: vi.fn() }));

import { controlWave } from "@/lib/actions/waves";

const team = (number: number, seats: number, over: object = {}) => ({ number, station: number, paymentStatus: "paid", waitlistedAt: null, _count: { competitors: seats }, ...over });
const wave = (teams: object[]) => ({
  id: "w1", seriesId: "s1", status: "pending", capacity: 9,
  series: { status: "live", archivedAt: null, zoneWorkMinutes: 6, zoneBreakMinutes: 2 },
  teams,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "hq", role: "admin", permissions: [] });
  mocks.tx.zone.count.mockResolvedValue(3);
  mocks.tx.wave.findMany.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("a wave with a team of one", () => {
  it("starts as before while the policy is off", async () => {
    mocks.tx.wave.findUnique.mockResolvedValue(wave([team(1, 2), team(2, 1)]));
    expect(await controlWave({ waveId: "w1", action: "start" })).toMatchObject({ ok: true });
    expect(mocks.tx.wave.update).toHaveBeenCalled();
  });

  it("is refused once the policy is on, naming the team — an unpaid team of one does not block it", async () => {
    vi.stubEnv("INCOMPLETE_TEAM_POLICY", "hold");
    mocks.tx.wave.findUnique.mockResolvedValue(wave([team(1, 2), team(12, 1), team(3, 1, { paymentStatus: "pending" })]));
    expect(await controlWave({ waveId: "w1", action: "start" })).toEqual({ ok: false, error: "INCOMPLETE_TEAM", teams: [12] });
    expect(mocks.tx.wave.update).not.toHaveBeenCalled();

    mocks.tx.wave.findUnique.mockResolvedValue(wave([team(1, 2), team(3, 1, { paymentStatus: "pending" })]));
    expect(await controlWave({ waveId: "w1", action: "start" })).toMatchObject({ ok: true });
  });
});
