/**
 * The partner directory is the one place an athlete sees another athlete, so
 * the test that matters most is the one that fails when somebody widens the
 * select. Everything else here is about who must not be offered.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRequests: vi.fn(),
  findProfiles: vi.fn(),
  countProfiles: vi.fn(),
  findProfile: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    partnerRequest: { findMany: mocks.findRequests },
    athleteProfile: {
      findMany: mocks.findProfiles,
      count: mocks.countProfiles,
      findFirst: mocks.findProfile,
    },
  },
}));

import { listPartnerCandidates, partnerCandidateExists } from "@/lib/partner-directory";

const me = { id: "me", division: "Open" as const, category: "Womens" as const };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findRequests.mockResolvedValue([]);
  mocks.countProfiles.mockResolvedValue(0);
  mocks.findProfiles.mockResolvedValue([]);
});

/** Every key named anywhere in a nested Prisma `select`. */
function keysIn(node: unknown, found: string[] = []): string[] {
  if (!node || typeof node !== "object") return found;
  for (const [key, value] of Object.entries(node)) {
    found.push(key);
    keysIn(value, found);
  }
  return found;
}

describe("what leaves the server", () => {
  const PERSONAL = [
    "email",
    "phone",
    "dateOfBirth",
    "sex",
    "shirtSize",
    "bftMember",
    "partnerEmail",
    "partnerPhone",
    "partnerName",
    "lastIp",
  ];

  it("never selects a contact detail, at any depth", async () => {
    await listPartnerCandidates({ me, query: "", page: 0 });

    const select = mocks.findProfiles.mock.calls[0][0].select;
    const selected = keysIn(select);
    for (const field of PERSONAL) expect(selected).not.toContain(field);
  });

  it("returns exactly five fields — a name, a bracket and a studio", async () => {
    mocks.findProfiles.mockResolvedValue([
      {
        userId: "u2",
        division: "Open",
        category: "Womens",
        user: { name: "Mona Adel", studio: { name: "BFT The Pearl" } },
      },
    ]);

    const { rows } = await listPartnerCandidates({ me, query: "", page: 0 });

    expect(Object.keys(rows[0]).sort()).toEqual([
      "category",
      "division",
      "id",
      "name",
      "studioName",
    ]);
    expect(rows[0]).toEqual({
      id: "u2",
      name: "Mona Adel",
      division: "Open",
      category: "Womens",
      studioName: "BFT The Pearl",
    });
  });

  it("says no studio rather than inventing one", async () => {
    mocks.findProfiles.mockResolvedValue([
      { userId: "u3", division: "Open", category: "Womens", user: { name: "Sara", studio: null } },
    ]);
    const { rows } = await listPartnerCandidates({ me, query: "", page: 0 });
    expect(rows[0].studioName).toBeNull();
  });
});

describe("who is offered", () => {
  it("asks only for people looking, in this athlete's own bracket", async () => {
    await listPartnerCandidates({ me, query: "", page: 0 });

    const where = mocks.findProfiles.mock.calls[0][0].where;
    // The three columns of the index this feature exists to use.
    expect(where.lookingForPartner).toBe(true);
    expect(where.division).toBe("Open");
    expect(where.category).toBe("Womens");
    expect(where.partnerUserId).toBeNull();
  });

  it("only offers an approved, active, unarchived competitor", async () => {
    await listPartnerCandidates({ me, query: "", page: 0 });

    const { user } = mocks.findProfiles.mock.calls[0][0].where;
    expect(user).toMatchObject({
      role: "competitor",
      approvalStatus: "approved",
      archivedAt: null,
      status: { not: "disabled" },
    });
  });

  it("searches by name without Prisma's Postgres-only insensitive mode", async () => {
    await listPartnerCandidates({ me, query: "  mona  ", page: 0 });

    const { user } = mocks.findProfiles.mock.calls[0][0].where;
    expect(user.name).toEqual({ contains: "mona" });
    expect(JSON.stringify(user.name)).not.toContain("mode");
  });

  it("never offers this athlete themselves", async () => {
    await listPartnerCandidates({ me, query: "", page: 0 });
    expect(mocks.findProfiles.mock.calls[0][0].where.userId.notIn).toContain("me");
  });

  it("hides anyone mid-conversation or already settled", async () => {
    mocks.findRequests.mockResolvedValue([
      { fromUserId: "me", toUserId: "asked", status: "pending" },
      { fromUserId: "asking", toUserId: "me", status: "pending" },
      { fromUserId: "me", toUserId: "partner", status: "accepted" },
    ]);

    await listPartnerCandidates({ me, query: "", page: 0 });

    const { notIn } = mocks.findProfiles.mock.calls[0][0].where.userId;
    expect(notIn).toEqual(expect.arrayContaining(["asked", "asking", "partner"]));
  });

  it("closes the door on asking somebody who already said no to me", async () => {
    mocks.findRequests.mockResolvedValue([
      { fromUserId: "me", toUserId: "refused-me", status: "declined" },
    ]);
    await listPartnerCandidates({ me, query: "", page: 0 });
    expect(mocks.findProfiles.mock.calls[0][0].where.userId.notIn).toContain("refused-me");
  });

  it("but lets me ask somebody I turned down — a no is not a promise", async () => {
    mocks.findRequests.mockResolvedValue([
      { fromUserId: "i-said-no-to-them", toUserId: "me", status: "declined" },
    ]);
    await listPartnerCandidates({ me, query: "", page: 0 });
    expect(mocks.findProfiles.mock.calls[0][0].where.userId.notIn).not.toContain(
      "i-said-no-to-them"
    );
  });
});

describe("re-checking one candidate before a request is sent", () => {
  it("applies the same rules to the single id", async () => {
    mocks.findProfile.mockResolvedValue({ userId: "u2" });

    expect(await partnerCandidateExists({ me, toUserId: "u2" })).toBe(true);

    expect(mocks.findProfile.mock.calls[0][0].where).toMatchObject({
      userId: "u2",
      lookingForPartner: true,
      division: "Open",
      category: "Womens",
      partnerUserId: null,
    });
  });

  it("refuses an id that no longer qualifies", async () => {
    mocks.findProfile.mockResolvedValue(null);
    expect(await partnerCandidateExists({ me, toUserId: "gone" })).toBe(false);
  });
});
