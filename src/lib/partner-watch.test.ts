import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ entries: vi.fn(), seats: vi.fn(), asks: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { seriesParticipant: { findMany: mocks.entries }, competitor: { findMany: mocks.seats }, partnerRequest: { findMany: mocks.asks } } }));
import { getPartnerWatch, countPairedNotRegistered } from "./partner-watch";
const entry = (id: string, partnerUserId: string | null = null, studioId = "gym1") => ({ userId: id, partnerUserId, lookingForPartner: !partnerUserId, division: "Open", category: "Mixed", partnerLinkedAt: null, user: { id, name: id, email: `${id}@example.com`, phone: "123456", studioId, studio: { name: studioId } } });
beforeEach(() => { vi.resetAllMocks(); mocks.entries.mockResolvedValue([entry("a"), entry("b")]); mocks.seats.mockResolvedValue([]); mocks.asks.mockResolvedValue([]); });
it("scopes every read to the selected competition", async () => {
  await getPartnerWatch({ seriesId: "training", studioId: null });
  expect(mocks.entries.mock.calls[0][0].where.seriesId).toBe("training");
  expect(mocks.seats.mock.calls[0][0].where.team.seriesId).toBe("training");
  expect(mocks.asks.mock.calls[0][0].where.seriesId).toBe("training");
});
it("gives staff reachable people, using shared identity", async () => {
  const result = await getPartnerWatch({ seriesId: "s1", studioId: "gym1" });
  expect(result.looking[0]).toMatchObject({ email: "a@example.com", phone: "123456", studioName: "gym1" });
});
it("shows a reciprocal cross-studio pair once to either studio", async () => {
  mocks.entries.mockResolvedValue([entry("a", "b"), entry("b", "a", "gym2")]);
  expect((await getPartnerWatch({ seriesId: "s1", studioId: "gym2" })).pairedNotRegistered).toHaveLength(1);
  expect(await countPairedNotRegistered("s1")).toBe(1);
  expect((await getPartnerWatch({ seriesId: "s1", studioId: "gym3" })).pairedNotRegistered).toHaveLength(0);
});
it("a team in this competition removes the pair from the queue", async () => {
  mocks.entries.mockResolvedValue([entry("a", "b"), entry("b", "a")]); mocks.seats.mockResolvedValue([{ userId: "a" }]);
  expect(await countPairedNotRegistered("s1")).toBe(0);
});
it("never joins a partner request to an athlete with no membership in this competition", async () => {
  mocks.asks.mockResolvedValue([{ id: "r1", fromUserId: "a", toUserId: "elsewhere", createdAt: new Date() }]);
  expect((await getPartnerWatch({ seriesId: "s1", studioId: null })).asking).toEqual([]);
});
it("requires reciprocal links", async () => {
  mocks.entries.mockResolvedValue([entry("a", "b"), entry("b", "c")]); expect(await countPairedNotRegistered("s1")).toBe(0);
});
