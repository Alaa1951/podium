/**
 * One person, one entry.
 *
 * This check existed four times by hand and was missing from the two paths
 * that create the most entries. The duplicate it allowed is invisible until
 * payment is confirmed, and then it is two rows on the board, two ranks in
 * the published results, and every figure in the reports counted twice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { competitor: { findFirst: mocks.findFirst } } }));

const { alreadyEntered, findEntryInSeries } = await import("@/lib/one-entry");

const seat = { id: "c1", teamId: "t1", email: "one@example.com", userId: "u1" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findFirst.mockResolvedValue(null);
});

describe("what it looks for", () => {
  it("asks about accounts and addresses together, inside one live competition", async () => {
    await findEntryInSeries({ seriesId: "s1", userIds: ["u1"], emails: ["one@example.com"] });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        // Archived entries do not count: a withdrawn pair may enter again.
        team: { seriesId: "s1", archivedAt: null },
        OR: [{ userId: { in: ["u1"] } }, { email: { in: ["one@example.com"] } }],
      },
      select: { id: true, teamId: true, email: true, userId: true },
    });
  });

  // One of the four hand-written copies passed emails through as typed, so it
  // only worked because of the column's collation. Lowercasing here means no
  // caller can get that wrong again.
  it("lowercases and trims every address it is given", async () => {
    await findEntryInSeries({ seriesId: "s1", emails: ["  ONE@Example.COM ", "Two@Example.com"] });
    expect(mocks.findFirst.mock.calls[0][0].where.OR).toEqual([
      { email: { in: ["one@example.com", "two@example.com"] } },
    ]);
  });

  it("drops the blanks rather than searching for them", async () => {
    await findEntryInSeries({ seriesId: "s1", userIds: [null, "u1"], emails: ["", undefined, "a@b.c"] });
    expect(mocks.findFirst.mock.calls[0][0].where.OR).toEqual([
      { userId: { in: ["u1"] } },
      { email: { in: ["a@b.c"] } },
    ]);
  });

  // THE ONE THAT MATTERS. An OR with no branches matches EVERY row, so an
  // empty search would report the first competitor in the event as a
  // duplicate of everybody — and refuse every registration after the first.
  it("never asks at all when there is nothing to look for", async () => {
    await expect(findEntryInSeries({ seriesId: "s1" })).resolves.toBeNull();
    await expect(findEntryInSeries({ seriesId: "s1", emails: [null, ""] })).resolves.toBeNull();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  // Swapping somebody onto a team compares them against everyone EXCEPT the
  // seat they are replacing, or the person being replaced blocks the swap.
  it("can ignore the seat being replaced", async () => {
    await findEntryInSeries({ seriesId: "s1", userIds: ["u1"], exceptCompetitorId: "c9" });
    expect(mocks.findFirst.mock.calls[0][0].where.NOT).toEqual({ id: "c9" });
  });

  it("leaves the NOT clause out entirely when there is nothing to ignore", async () => {
    await findEntryInSeries({ seriesId: "s1", userIds: ["u1"] });
    expect(mocks.findFirst.mock.calls[0][0].where).not.toHaveProperty("NOT");
  });
});

describe("what it answers", () => {
  // The CRM does not want to refuse — it wants to recognise the team it is
  // looking at and adopt it instead of making a second one.
  it("names the seat and its team, not just yes or no", async () => {
    mocks.findFirst.mockResolvedValue(seat);
    await expect(findEntryInSeries({ seriesId: "s1", emails: ["one@example.com"] })).resolves.toEqual({
      competitorId: "c1",
      teamId: "t1",
      email: "one@example.com",
      userId: "u1",
    });
  });

  it("answers plainly for the callers that only need to refuse", async () => {
    mocks.findFirst.mockResolvedValue(seat);
    await expect(alreadyEntered({ seriesId: "s1", emails: ["one@example.com"] })).resolves.toBe(true);
    mocks.findFirst.mockResolvedValue(null);
    await expect(alreadyEntered({ seriesId: "s1", emails: ["one@example.com"] })).resolves.toBe(false);
  });
});
