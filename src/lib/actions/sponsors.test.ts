import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  series: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireAccess: mocks.access }));
vi.mock("@/lib/audit", () => ({ AUDIT: { seriesSponsorChanged: "series.sponsor_changed" }, recordAudit: vi.fn() }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const sponsor = { findFirst: mocks.findFirst, findUnique: mocks.findUnique, create: mocks.create, update: mocks.update, deleteMany: mocks.deleteMany };
  return { prisma: { series: { findUnique: mocks.series }, sponsor, $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ sponsor }) } };
});

import { moveSponsor, saveSponsor } from "@/lib/actions/sponsors";

const logo = { seriesId: "event-1", alt: "Partner", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ id: "admin-1" });
  mocks.series.mockResolvedValue({ id: "event-1" });
  mocks.findFirst.mockResolvedValue(null);
});

describe("sponsors beyond the former ten-logo limit", () => {
  it.each([10, 20, 24, 100])("saves a sponsor at position %i", async position => {
    expect(await saveSponsor({ ...logo, position })).toEqual({ ok: true, message: "Sponsor saved." });
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ seriesId: "event-1", position }) });
    expect(mocks.access).toHaveBeenCalledWith("sponsors.edit");
  });

  it("keeps occupied positions protected above ten", async () => {
    mocks.findFirst.mockResolvedValue({ id: "existing" });
    expect(await saveSponsor({ ...logo, position: 24 })).toEqual({ ok: false, error: "POSITION_TAKEN" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("cannot edit a sponsor belonging to another competition", async () => {
    expect(await saveSponsor({ ...logo, sponsorId: "other-event-sponsor", position: 24 })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(mocks.findFirst).toHaveBeenLastCalledWith({ where: { id: "other-event-sponsor", seriesId: "event-1" } });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("swaps neighbours above twenty without colliding with another logo", async () => {
    mocks.findUnique.mockResolvedValueOnce({ id: "a", seriesId: "event-1", position: 23 }).mockResolvedValueOnce({ id: "b" });
    const positions = new Map([["a", 23], ["b", 24], ["old-sentinel", 1010]]);
    mocks.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: { position: number } }) => {
      expect([...positions].some(([id, position]) => id !== where.id && position === data.position)).toBe(false);
      positions.set(where.id, data.position);
    });
    expect(await moveSponsor({ seriesId: "event-1", sponsorId: "a", direction: "down" })).toEqual({ ok: true });
    expect(positions.get("a")).toBe(24);
    expect(positions.get("b")).toBe(23);
    expect(positions.get("old-sentinel")).toBe(1010);
  });

  it.each([-1, 1.5, 2_147_483_647])("rejects invalid or reserved position %s", async position => {
    expect(await saveSponsor({ ...logo, position })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
