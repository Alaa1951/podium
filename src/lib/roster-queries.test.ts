import { beforeEach, describe, expect, it, vi } from "vitest";
import { teamScope, type CurrentUser } from "@/lib/access";

const mocks = vi.hoisted(() => ({ teams: vi.fn(), zones: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  team: { findMany: mocks.teams }, zone: { findMany: mocks.zones },
} }));
vi.mock("@/lib/session", () => ({ teamScope }));

import { getArchivedRoster, getScopedRoster, getWaitingRoster } from "@/lib/queries";

const studio: CurrentUser = {
  id: "studio-user", email: "studio@example.test", name: null, role: "studio",
  studioId: "own-studio", locale: "en", permissions: [],
};
const row = {
  id: "team-1", number: 7, name: "Pair", category: "Womens", division: "Rookie",
  wave: 1, waveId: "wave-1", studioId: "own-studio", studio: { name: "Studio" },
  scoreEdits: 2, paymentStatus: "paid", source: "manual", registeredAt: new Date(0),
  paidAt: new Date(0), amountMinor: 25000, currency: "QAR", billingNumber: null,
  externalId: null, attendedAt: new Date(0), score: { status: "submitted" },
  competitors: [{ id: "person-1", position: 1, fullName: "Person", phone: "123",
    email: "person@example.test", dateOfBirth: new Date(0), studioId: "own-studio",
    studio: { name: "Studio" }, userId: "person-user" }],
};

beforeEach(() => { vi.resetAllMocks(); mocks.teams.mockResolvedValue([row]); });

describe("lean registration reads", () => {
  it("keeps the displayed registration, attendance, payment and person facts without loading scoring inputs", async () => {
    const [team] = await getScopedRoster("series-1", studio);
    expect(team).toMatchObject({ id: "team-1", submitted: true, paymentStatus: "paid",
      amountMinor: 25000, attendedAt: new Date(0), studioName: "Studio",
      competitors: [{ id: "person-1", email: "person@example.test", studioName: "Studio" }] });
    expect(team).not.toHaveProperty("values");
    expect(mocks.teams).toHaveBeenCalledWith(expect.objectContaining({
      where: { seriesId: "series-1", archivedAt: null, studioId: "own-studio" },
      include: expect.objectContaining({ score: { select: { status: true } } }),
    }));
    expect(mocks.zones).not.toHaveBeenCalled();
  });

  it("combines a detail ID with competition and studio restrictions, including during preview", async () => {
    mocks.teams.mockResolvedValue([]);
    expect(await getScopedRoster("series-1", { ...studio, viewAs: { byAdminId: "admin" } }, "other-team")).toEqual([]);
    expect(mocks.teams).toHaveBeenCalledWith(expect.objectContaining({
      where: { seriesId: "series-1", archivedAt: null, studioId: "own-studio", id: "other-team" },
    }));
  });

  it("fails closed when a studio has no studio assignment and scopes competitors to their account", async () => {
    await getScopedRoster("series-1", { ...studio, studioId: null }, "team-1");
    expect(mocks.teams.mock.lastCall?.[0].where.studioId).toBe(teamScope({ ...studio, studioId: null }).studioId);
    await getScopedRoster("series-1", { ...studio, role: "competitor" }, "team-1");
    expect(mocks.teams.mock.lastCall?.[0].where).toMatchObject({
      id: "team-1", seriesId: "series-1", competitors: { some: { userId: studio.id } },
    });
  });

  it("keeps archived entries in their separate scoped query", async () => {
    await getArchivedRoster("series-1", studio);
    expect(mocks.teams.mock.lastCall?.[0].where).toEqual({
      seriesId: "series-1", NOT: { archivedAt: null }, studioId: "own-studio",
    });
  });
});

describe("the waiting list", () => {
  // Three filters, and dropping any one of them is a different wrong answer:
  // without `waitlistedAt` it is the whole roster, without `archivedAt` it
  // shows withdrawn pairs as waiting, and without the scope a studio reads
  // everybody else's entries.
  it("reads only the waiting, only the live, and only what this account may see", async () => {
    await getWaitingRoster("series-1", studio);
    expect(mocks.teams).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          seriesId: "series-1",
          archivedAt: null,
          NOT: { waitlistedAt: null },
          studioId: "own-studio",
        },
        // Longest waiting first: the order of a list whose whole purpose is
        // deciding who gets let in next.
        orderBy: { waitlistedAt: "asc" },
      })
    );
  });

  it("gives BFT MENA every waiting entry in the competition", async () => {
    await getWaitingRoster("series-1", { ...studio, role: "admin", studioId: null });
    expect(mocks.teams.mock.lastCall?.[0].where).toEqual({
      seriesId: "series-1",
      archivedAt: null,
      NOT: { waitlistedAt: null },
    });
  });
});
