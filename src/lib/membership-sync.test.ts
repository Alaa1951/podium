/**
 * Derived partner links follow the team's CURRENT seats — for both members,
 * from the roster, never from an older partnership choice.
 */
import { describe, expect, it, vi } from "vitest";

import { reconcileDerivedLinks } from "@/lib/membership-sync";

type FakeSeat = { id: string; userId: string | null };

/**
 * Who holds each seat is answered by the LOCKING read ($queryRaw); the plain
 * read of the team supplies names and contacts only.
 */
function fakeDb(team: { seriesId: string; name: string; competitors: FakeSeat[] } | null, participants: Record<string, { id: string } | null>, holders?: FakeSeat[]) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(holders ?? team?.competitors.map(({ id, userId }) => ({ id, userId })) ?? []),
    team: { findUnique: vi.fn().mockResolvedValue(team) },
    seriesParticipant: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { seriesId_userId: { userId: string } } }) => participants[where.seriesId_userId.userId] ?? null),
      update: vi.fn().mockResolvedValue(undefined),
    },
    partnerRequest: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
}

const seat = (userId: string | null, fullName: string, email: string | null) => ({
  id: `seat-${fullName}`, userId, fullName, email, phone: null, dateOfBirth: null, shirtSize: "M", bftMember: false,
});

describe("a complete team", () => {
  it("points both members at each other, settles them, and cancels their pending requests", async () => {
    const db = fakeDb({ seriesId: "s1", name: "FALCONS", competitors: [seat("u1", "Sara", "sara@x.com"), seat("u2", "Mona", "mona@x.com")] }, { u1: { id: "p1" }, u2: { id: "p2" } });
    await reconcileDerivedLinks(db as never, "t1");
    expect(db.seriesParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "p1" },
      data: expect.objectContaining({ partnerUserId: "u2", partnerName: "Mona", partnerEmail: "mona@x.com", lookingForPartner: false, teamName: "FALCONS" }),
    }));
    expect(db.seriesParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "p2" },
      data: expect.objectContaining({ partnerUserId: "u1", partnerName: "Sara" }),
    }));
    expect(db.partnerRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "pending", OR: [{ fromUserId: "u1" }, { toUserId: "u1" }] }) }));
  });

  it("snapshots a partner who has no account yet, with no partnerUserId", async () => {
    const db = fakeDb({ seriesId: "s1", name: "FALCONS", competitors: [seat("u1", "Sara", "sara@x.com"), seat(null, "New Person", "new@x.com")] }, { u1: { id: "p1" } });
    await reconcileDerivedLinks(db as never, "t1");
    expect(db.seriesParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ partnerUserId: null, partnerLinkedAt: null, partnerName: "New Person", partnerEmail: "new@x.com", lookingForPartner: false }),
    }));
  });
});

describe("the committed roster decides", () => {
  it("links a partner who claimed their seat after this transaction's plain reads began", async () => {
    const sara = seat("u1", "Sara", "sara@x.com");
    const mona = seat(null, "Mona", "mona@x.com"); // the plain read has not seen Mona's claim
    const db = fakeDb({ seriesId: "s1", name: "FALCONS", competitors: [sara, mona] } as never, { u1: { id: "p1" }, u2: { id: "p2" } }, [
      { id: sara.id, userId: "u1" },
      { id: mona.id, userId: "u2" }, // …the locking read has
    ]);
    await reconcileDerivedLinks(db as never, "t1");
    expect(db.seriesParticipant.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1" }, data: expect.objectContaining({ partnerUserId: "u2" }) }));
    expect(db.seriesParticipant.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p2" }, data: expect.objectContaining({ partnerUserId: "u1" }) }));
  });
});

describe("a solo entry", () => {
  it("clears the partner fields and leaves the looking flag and requests alone", async () => {
    const db = fakeDb({ seriesId: "s1", name: "SOLO", competitors: [seat("u1", "Sara", "sara@x.com")] }, { u1: { id: "p1" } });
    await reconcileDerivedLinks(db as never, "t1");
    const data = db.seriesParticipant.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ partnerUserId: null, partnerName: null, partnerEmail: null });
    expect(data).not.toHaveProperty("lookingForPartner");
    expect(db.partnerRequest.updateMany).not.toHaveBeenCalled();
  });
});

it("does nothing for an unknown team or a member without a participant row", async () => {
  const db = fakeDb(null, {});
  await reconcileDerivedLinks(db as never, "nope");
  expect(db.seriesParticipant.update).not.toHaveBeenCalled();
  const noRow = fakeDb({ seriesId: "s1", name: "X", competitors: [seat("u1", "Sara", null), seat("u2", "Mona", null)] }, {});
  await reconcileDerivedLinks(noRow as never, "t1");
  expect(noRow.seriesParticipant.update).not.toHaveBeenCalled();
});
