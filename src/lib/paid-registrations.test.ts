import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ teams: vi.fn(), intakes: vi.fn(), merges: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  team: { findMany: mocks.teams }, crmIntake: { findMany: mocks.intakes },
  crmRegistrationMerge: { findMany: mocks.merges },
} }));
vi.mock("@/lib/crm/sync", () => ({ crmSyncEnabled: mocks.enabled }));
const { getPaidRegistrationSummary } = await import("@/lib/paid-registrations");

const team = (externalId: string | null, overrides = {}) => ({
  externalId, paymentStatus: "paid", archivedAt: null, waitlistedAt: null, ...overrides,
});
const intake = (externalId: string, stageName: string | null = "Paid – Not Registered") => ({ externalId, stageName });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.teams.mockResolvedValue([]);
  mocks.intakes.mockResolvedValue([]);
  mocks.merges.mockResolvedValue([]);
  mocks.enabled.mockReturnValue(true);
});

describe("Paid - Total", () => {
  it("counts 66 paid teams plus 21 paid incomplete registrations, excluding the two unpaid teams", async () => {
    mocks.teams.mockResolvedValue([
      ...Array.from({ length: 66 }, (_, i) => team(`paid-${i}`)),
      team("unpaid-1", { paymentStatus: "pending" }), team("unpaid-2", { paymentStatus: "pending" }),
    ]);
    mocks.intakes.mockResolvedValue(Array.from({ length: 21 }, (_, i) => intake(`incomplete-${i}`)));
    expect(await getPaidRegistrationSummary("series-1", true)).toEqual({
      inField: 66, waitingTeams: 0, incomplete: 21, waiting: 21, total: 87,
    });
  });

  it("includes paid waiting teams but excludes unpaid, refunded, unknown and withdrawn registrations", async () => {
    mocks.teams.mockResolvedValue([
      team(null), team("queue", { waitlistedAt: new Date() }),
      team("queue-unpaid", { paymentStatus: "pending", waitlistedAt: new Date() }),
      team("refund", { paymentStatus: "refunded" }), team("withdrawn", { archivedAt: new Date() }),
    ]);
    mocks.intakes.mockResolvedValue([
      intake("paid"), intake("unpaid", "Registered but Not Paid"), intake("refund-intake", "Refunded"),
      intake("unknown", "Waiting list"), intake("no-stage", null), intake("withdrawn"),
    ]);
    expect(await getPaidRegistrationSummary("series-1", true)).toEqual({
      inField: 1, waitingTeams: 1, incomplete: 1, waiting: 2, total: 3,
    });
  });

  it("counts a registration once when it exists in both tables or has a retired CRM record", async () => {
    mocks.teams.mockResolvedValue([team("payer"), team("refunded", { paymentStatus: "refunded" })]);
    mocks.intakes.mockResolvedValue([intake("payer"), intake("retired"), intake("refunded"), intake("new"), intake("new")]);
    mocks.merges.mockResolvedValue([{ retiredExternalId: "retired", canonicalExternalId: "payer" }]);
    expect((await getPaidRegistrationSummary("series-1", true)).total).toBe(2);
    for (const query of [mocks.teams, mocks.intakes, mocks.merges]) {
      expect(query).toHaveBeenCalledWith(expect.objectContaining({ where: { seriesId: "series-1" } }));
    }
  });

  it.each([[false, true], [true, false]])("does not read hidden CRM intake (permission %s, sync %s)", async (includeIntake, enabled) => {
    mocks.enabled.mockReturnValue(enabled);
    mocks.teams.mockResolvedValue([team("paid")]);
    expect((await getPaidRegistrationSummary("series-1", includeIntake)).total).toBe(1);
    expect(mocks.intakes).not.toHaveBeenCalled();
    expect(mocks.merges).not.toHaveBeenCalled();
  });

  it("returns zero for an empty competition", async () => {
    expect(await getPaidRegistrationSummary("empty", true)).toEqual({ inField: 0, waitingTeams: 0, incomplete: 0, waiting: 0, total: 0 });
  });
});
