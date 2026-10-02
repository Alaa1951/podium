/**
 * Who may put people on zones. Two permissions, one boundary:
 *
 *   zoneStaff.assign        everything, every zone — the supervisor.
 *   zoneStaff.assignJudges  the Zone Leaders role: judges and reserves on and
 *                           off, on the zones the person LEADS — leaders and
 *                           other zones stay out of reach.
 *
 * Several people may lead one zone: appointing a new leader leaves the ones
 * already there alone. That used to demote them; this pins it away.
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
  countStaff: vi.fn(),
  findStaffRow: vi.fn(),
  deleteStaff: vi.fn(),
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
    zoneStaff: {
      upsert: mocks.upsertStaff,
      updateMany: mocks.updateManyStaff,
      count: mocks.countStaff,
      findUnique: mocks.findStaffRow,
      delete: mocks.deleteStaff,
    },
  },
}));

import { addZoneStaff, removeZoneStaff } from "@/lib/actions/zone-staff";

const actor = { id: "assigner-1", viewAs: null };

/** The actor's permission set: full, judges-only, or neither. */
const holds = (...keys: string[]) => mocks.can.mockImplementation((_user, key: string) => keys.includes(key));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue(actor);
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
  mocks.deleteStaff.mockResolvedValue({});
});

describe("addZoneStaff — the supervisor (zoneStaff.assign)", () => {
  it("appoints anyone, any zone, leaders included", async () => {
    holds("zoneStaff.assign");
    const result = await addZoneStaff({ zoneId: "zone-1", userId: "user-2", position: "leader" });
    expect(result).toEqual({ ok: true });
    expect(mocks.upsertStaff).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ position: "leader" }) })
    );
  });

  it("leaves the zone's other leaders in place when one more is appointed", async () => {
    holds("zoneStaff.assign");
    await addZoneStaff({ zoneId: "zone-1", userId: "user-2", position: "leader" });
    expect(mocks.updateManyStaff).not.toHaveBeenCalled();
  });
});

describe("addZoneStaff — the Zone Leaders role (zoneStaff.assignJudges)", () => {
  it("puts a judge on the zone they lead", async () => {
    holds("zoneStaff.assignJudges");
    mocks.countStaff.mockResolvedValue(1);
    const result = await addZoneStaff({ zoneId: "zone-1", userId: "user-2", position: "judge" });
    expect(result).toEqual({ ok: true });
    expect(mocks.upsertStaff).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ position: "judge" }) })
    );
  });

  it("refuses to appoint a leader, even on a zone they lead", async () => {
    holds("zoneStaff.assignJudges");
    const result = await addZoneStaff({ zoneId: "zone-1", userId: "user-2", position: "leader" });
    expect(result).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.upsertStaff).not.toHaveBeenCalled();
  });

  it("refuses a zone they do not lead", async () => {
    holds("zoneStaff.assignJudges");
    mocks.countStaff.mockResolvedValue(0);
    const result = await addZoneStaff({ zoneId: "zone-1", userId: "user-2", position: "judge" });
    expect(result).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.upsertStaff).not.toHaveBeenCalled();
  });
});

describe("removeZoneStaff", () => {
  it("lets the judges-only role take a judge off the zone they lead", async () => {
    holds("zoneStaff.assignJudges");
    mocks.findStaffRow.mockResolvedValue({ id: "s1", seriesId: "series-1", position: "judge", zoneId: "zone-1", zone: { number: 1 }, user: { email: "judge@bftmiddleeast.com" } });
    mocks.countStaff.mockResolvedValue(1);
    const result = await removeZoneStaff({ staffId: "s1" });
    expect(result).toEqual({ ok: true });
    expect(mocks.deleteStaff).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("never lets the judges-only role remove a leader", async () => {
    holds("zoneStaff.assignJudges");
    mocks.findStaffRow.mockResolvedValue({ id: "s1", seriesId: "series-1", position: "leader", zoneId: "zone-1", zone: { number: 1 }, user: { email: "leader@bftmiddleeast.com" } });
    mocks.countStaff.mockResolvedValue(1);
    const result = await removeZoneStaff({ staffId: "s1" });
    expect(result).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.deleteStaff).not.toHaveBeenCalled();
  });

  it("refuses the judges-only role on a zone they do not lead", async () => {
    holds("zoneStaff.assignJudges");
    mocks.findStaffRow.mockResolvedValue({ id: "s1", seriesId: "series-1", position: "judge", zoneId: "zone-1", zone: { number: 1 }, user: { email: "judge@bftmiddleeast.com" } });
    mocks.countStaff.mockResolvedValue(0);
    const result = await removeZoneStaff({ staffId: "s1" });
    expect(result).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.deleteStaff).not.toHaveBeenCalled();
  });

  it("refuses anyone holding neither permission", async () => {
    holds();
    const result = await addZoneStaff({ zoneId: "zone-1", userId: "user-2", position: "judge" });
    expect(result).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.upsertStaff).not.toHaveBeenCalled();
  });
});

describe("both roles alike", () => {
  it("refuses someone whose roles do not carry the judge sheet", async () => {
    holds("zoneStaff.assign");
    mocks.loadPermissions.mockResolvedValue(["judgeSheet.view"]);
    const result = await addZoneStaff({ zoneId: "zone-1", userId: "user-2", position: "judge" });
    expect(result).toEqual({ ok: false, error: "NOT_A_JUDGE" });
    expect(mocks.upsertStaff).not.toHaveBeenCalled();
  });
});
