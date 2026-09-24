import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), upsert: vi.fn(), entry: vi.fn(), series: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.user }, seriesParticipant: { upsert: mocks.upsert, findUnique: mocks.entry }, series: { findMany: mocks.series } } }));
import { ensureParticipation, loadSeriesAthlete, resolveMySeries } from "./participation";
beforeEach(() => { vi.resetAllMocks(); });
describe("shared account, independent entries", () => {
  it("joining another competition copies preferences without copying the old partner or creating a new account", async () => {
    mocks.user.mockResolvedValue({ id: "same", status: "active", archivedAt: null, athleteProfile: { division: "Open", category: "Mixed", shirtSize: "L", partnerUserId: "old-partner" } });
    await ensureParticipation("same", "training");
    const input = mocks.upsert.mock.calls[0][0];
    expect(input.where).toEqual({ seriesId_userId: { seriesId: "training", userId: "same" } });
    expect(input.update).toEqual({}); expect(input.create).not.toHaveProperty("partnerUserId");
    expect(input.create).toMatchObject({ userId: "same", seriesId: "training", division: "Open" });
  });
  it("reads account edits in both competitions while keeping different partners and brackets", async () => {
    const user = { id: "same", name: "Original", athleteProfile: { sex: "f", dateOfBirth: new Date("1990-01-01") } };
    mocks.entry.mockImplementation(async ({ where }) => ({ user, userId: user.id, seriesId: where.seriesId_userId.seriesId, division: where.seriesId_userId.seriesId === "source" ? "Open" : "Rookie", partnerUserId: where.seriesId_userId.seriesId === "source" ? "b" : "c" }));
    user.name = "Corrected";
    const a = await loadSeriesAthlete("same", "source"), b = await loadSeriesAthlete("same", "training");
    expect(a?.name).toBe("Corrected"); expect(b?.name).toBe("Corrected");
    expect(a?.athleteProfile.partnerUserId).toBe("b"); expect(b?.athleteProfile.partnerUserId).toBe("c");
    expect(a?.athleteProfile.division).toBe("Open"); expect(b?.athleteProfile.division).toBe("Rookie");
  });
  it("cannot select somebody else's event; root defaults to running and excludes completed", async () => {
    mocks.series.mockResolvedValue([{ id: "upcoming", name: "Next", status: "scheduled", competitionDate: new Date("2099-01-01") }, { id: "running", name: "Now", status: "live", competitionDate: new Date() }, { id: "done", name: "Done", status: "final", competitionDate: new Date() }]);
    expect((await resolveMySeries("same"))?.id).toBe("running");
    expect(await resolveMySeries("same", "somebody-else")).toBeNull(); expect(await resolveMySeries("same", "done")).toBeNull();
    expect(mocks.series.mock.calls[0][0].where.OR[0]).toEqual({ participants: { some: { userId: "same", archivedAt: null } } });
  });
});
