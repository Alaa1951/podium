/**
 * Several people may lead one zone: appointing a new leader must leave the
 * ones already there alone. This pins the old behaviour away — "Make leader"
 * used to demote every other leader of the zone to a judge.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  can: vi.fn(),
  isFloorAccount: vi.fn(),
  loadPermissions: vi.fn(),
  findZone: vi.fn(),
  findUser: vi.fn(),
  upsertStaff: vi.fn(),
  updateManyStaff: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/access", () => ({ can: mocks.can, isFloorAccount: mocks.isFloorAccount }));
vi.mock("@/lib/permissions/load", () => ({ loadPermissions: mocks.loadPermissions }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(), AUDIT: { zoneStaffChanged: "zoneStaff.changed" } }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    zone: { findUnique: mocks.findZone },
    user: { findUnique: mocks.findUser },
    zoneStaff: { upsert: mocks.upsertStaff, updateMany: mocks.updateManyStaff },
  },
}));

import { addZoneStaff } from "@/lib/actions/zone-staff";

const actor = { id: "assigner-1", viewAs: null };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue(actor);
  mocks.can.mockReturnValue(true);
  mocks.isFloorAccount.mockReturnValue(true);
  mocks.loadPermissions.mockResolvedValue(["judgeSheet.view", "scores.enter"]);
  mocks.findZone.mockResolvedValue({ id: "zone-1", number: 1, seriesId: "series-1" });
  mocks.findUser.mockResolvedValue({
    id: "user-2",
    email: "second@bftmiddleeast.com",
    role: "organiser",
    status: "active",
    archivedAt: null,
  });
  mocks.upsertStaff.mockResolvedValue({});
});

describe("addZoneStaff", () => {
  it("appoints the person in the asked-for position", async () => {
    const result = await addZoneStaff({ zoneId: "zone-1", userId: "user-2", position: "leader" });
    expect(result).toEqual({ ok: true });
    expect(mocks.upsertStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { zoneId_userId: { zoneId: "zone-1", userId: "user-2" } },
        update: expect.objectContaining({ position: "leader" }),
      })
    );
  });

  it("leaves the zone's other leaders in place when one more is appointed", async () => {
    await addZoneStaff({ zoneId: "zone-1", userId: "user-2", position: "leader" });
    expect(mocks.updateManyStaff).not.toHaveBeenCalled();
  });

  it("refuses someone whose roles do not carry the judge sheet", async () => {
    mocks.loadPermissions.mockResolvedValue(["judgeSheet.view"]);
    const result = await addZoneStaff({ zoneId: "zone-1", userId: "user-2", position: "judge" });
    expect(result).toEqual({ ok: false, error: "NOT_A_JUDGE" });
    expect(mocks.upsertStaff).not.toHaveBeenCalled();
  });
});
