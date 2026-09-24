import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { seriesParticipant: { findMany: mocks.find, updateMany: mocks.update }, $transaction: mocks.transaction } }));
import { linkPair, unlinkPair } from "./partners";
const entry = (id: string) => ({ userId: id, shirtSize: "M", bftMember: true, user: { name: `Name ${id}`, email: `${id}@example.com`, phone: "123456", athleteProfile: { sex: "f", dateOfBirth: null } } });
const tx = { seriesParticipant: { findMany: mocks.find, updateMany: mocks.update } };
beforeEach(() => { vi.resetAllMocks(); mocks.find.mockResolvedValue([entry("a"), entry("b")]); mocks.update.mockResolvedValue({ count: 1 }); mocks.transaction.mockImplementation(async fn => fn(tx)); });
describe("per-competition partnerships", () => {
  it("links both sides using the selected participation and shared identity", async () => {
    await linkPair("a", "b", "training");
    expect(mocks.find.mock.calls[0][0].where).toMatchObject({ seriesId: "training", archivedAt: null });
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ where: { seriesId: "training", userId: "a" }, data: { partnerUserId: "b", partnerEmail: "b@example.com", partnerShirtSize: "M" } });
    expect(mocks.update.mock.calls[1][0]).toMatchObject({ where: { seriesId: "training", userId: "b" }, data: { partnerUserId: "a" } });
  });
  it("unlink clears every mirrored partner field and only in this competition", async () => {
    await linkPair("a", "b", "training"); const linked = Object.keys(mocks.update.mock.calls[0][0].data);
    mocks.update.mockClear(); await unlinkPair("a", "b", "training");
    for (const [args] of mocks.update.mock.calls) {
      expect(args.where.seriesId).toBe("training");
      expect(Object.keys(args.data).sort()).toEqual([...linked, "teamName"].sort());
      expect(args.data).toMatchObject({ partnerUserId: null, partnerEmail: null, lookingForPartner: true });
    }
  });
  it("refuses a missing membership instead of using a partner from another competition", async () => {
    mocks.find.mockResolvedValue([entry("a")]);
    await expect(linkPair("a", "b", "training")).rejects.toThrow("NOT_FOUND"); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects a concurrently claimed partnership", async () => {
    mocks.update.mockResolvedValue({ count: 0 }); await expect(linkPair("a", "b", "training")).rejects.toThrow("ALREADY_LINKED");
    expect(mocks.update.mock.calls[0][0].where.OR).toEqual([{ partnerUserId: null }, { partnerUserId: "b" }]);
  });
  it("uses the caller transaction for an atomic team and partner write", async () => {
    await linkPair("a", "b", "training", tx as never); expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.update).toHaveBeenCalledTimes(2);
  });
  it("does not unlink somebody who has moved on to a third partner", async () => {
    await unlinkPair("a", "b", "training"); expect(mocks.update.mock.calls[0][0].where.OR).toEqual([{ partnerUserId: "b" }, { partnerUserId: null }]);
  });
});
