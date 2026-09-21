/**
 * The staff's view of the people with nobody yet.
 *
 * The test that matters here is the MIRROR of the one in
 * partner-directory.test.ts: that select must not carry a contact detail, and
 * this one must. Side by side, the two intentions are legible, and narrowing
 * this one by mistake fails rather than quietly breaking the job it exists for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUsers: vi.fn(),
  findRequests: vi.fn(),
  findProfiles: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.findUsers },
    partnerRequest: { findMany: mocks.findRequests },
    athleteProfile: { findMany: mocks.findProfiles },
  },
}));

import { countPairedNotRegistered, getPartnerWatch } from "@/lib/partner-watch";

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Name ${id}`,
  email: `${id}@example.com`,
  phone: "+97455500000",
  studio: { name: "BFT The Pearl" },
  athleteProfile: { division: "Open", category: "Womens" },
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findUsers.mockResolvedValue([]);
  mocks.findRequests.mockResolvedValue([]);
  mocks.findProfiles.mockResolvedValue([]);
});

describe("what staff are given", () => {
  it("selects the contact details — ringing somebody is the job", async () => {
    await getPartnerWatch({ seriesId: "s1", studioId: null });

    const select = mocks.findUsers.mock.calls[0][0].select;
    expect(select.email).toBe(true);
    expect(select.phone).toBe(true);
  });

  it("returns a reachable person", async () => {
    mocks.findUsers.mockResolvedValue([person("u1")]);

    const watch = await getPartnerWatch({ seriesId: "s1", studioId: null });

    expect(watch.looking[0]).toEqual({
      userId: "u1",
      name: "Name u1",
      email: "u1@example.com",
      phone: "+97455500000",
      division: "Open",
      category: "Womens",
      studioName: "BFT The Pearl",
    });
  });

  it("falls back to the address when somebody has no name", async () => {
    mocks.findUsers.mockResolvedValue([person("u2", { name: null })]);
    const watch = await getPartnerWatch({ seriesId: "s1", studioId: null });
    expect(watch.looking[0].name).toBe("u2@example.com");
  });
});

describe("who counts as being in this competition", () => {
  it("takes both the sign-up choice and an existing entry", async () => {
    await getPartnerWatch({ seriesId: "s1", studioId: null });

    const { where } = mocks.findUsers.mock.calls[0][0];
    expect(where.OR).toEqual([
      { requestedSeriesId: "s1" },
      { competitors: { some: { team: { seriesId: "s1", archivedAt: null } } } },
    ]);
    // An athlete who arrived through the CRM has no requestedSeriesId; the
    // second branch is what keeps them visible.
    expect(where).toMatchObject({
      role: "competitor",
      approvalStatus: "approved",
      archivedAt: null,
      status: { not: "disabled" },
    });
  });

  it("scopes a studio to its own people", async () => {
    await getPartnerWatch({ seriesId: "s1", studioId: "studio-a" });
    expect(mocks.findUsers.mock.calls[0][0].where.studioId).toBe("studio-a");
  });

  it("leaves BFT MENA unscoped", async () => {
    await getPartnerWatch({ seriesId: "s1", studioId: null });
    expect(mocks.findUsers.mock.calls[0][0].where.studioId).toBeUndefined();
  });

  it("shows a studio a cross-studio pair when either side is theirs", async () => {
    await getPartnerWatch({ seriesId: "s1", studioId: "studio-a" });
    const { where } = mocks.findProfiles.mock.calls[0][0];
    expect(where.OR).toEqual([
      { user: { studioId: "studio-a" } },
      { partner: { studioId: "studio-a" } },
    ]);
  });
});

describe("pairs waiting to be entered", () => {
  const pair = {
    userId: "aaa",
    partnerUserId: "bbb",
    partnerLinkedAt: new Date("2026-09-20T00:00:00Z"),
    user: person("aaa"),
    partner: person("bbb"),
  };

  it("lists a pair once, not twice", async () => {
    // Both sides of the same pair come back from the query.
    mocks.findProfiles.mockResolvedValue([
      pair,
      { ...pair, userId: "bbb", partnerUserId: "aaa", user: person("bbb"), partner: person("aaa") },
    ]);

    const watch = await getPartnerWatch({ seriesId: "s1", studioId: null });

    expect(watch.pairedNotRegistered).toHaveLength(1);
    expect(watch.pairedNotRegistered[0].a.userId).toBe("aaa");
    expect(watch.pairedNotRegistered[0].b.userId).toBe("bbb");
  });

  it("wants both of them without a team in this competition", async () => {
    await getPartnerWatch({ seriesId: "s1", studioId: null });
    const { where } = mocks.findProfiles.mock.calls[0][0];
    const noTeam = { competitors: { none: { team: { seriesId: "s1", archivedAt: null } } } };
    expect(where.user).toMatchObject(noTeam);
    expect(where.partner).toMatchObject(noTeam);
  });

  it("counts each pair once for the badge", async () => {
    mocks.findProfiles.mockResolvedValue([
      { userId: "aaa", partnerUserId: "bbb" },
      { userId: "bbb", partnerUserId: "aaa" },
      { userId: "ccc", partnerUserId: "ddd" },
    ]);
    expect(await countPairedNotRegistered("s1")).toBe(2);
  });
});

describe("asks in flight", () => {
  it("wants at least one side in this competition", async () => {
    await getPartnerWatch({ seriesId: "s1", studioId: "studio-a" });
    const { where } = mocks.findRequests.mock.calls[0][0];
    expect(where.status).toBe("pending");
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toHaveProperty("from");
    expect(where.OR[1]).toHaveProperty("to");
  });
});
