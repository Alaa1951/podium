import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ ensure: vi.fn(), link: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/participation", () => ({ ensureParticipation: mocks.ensure }));
vi.mock("@/lib/partners", () => ({ linkPair: mocks.link }));
import { createTeam, type NewTeam } from "./team-create";
const input: NewTeam = { seriesId: "training", name: "Pair", category: "Mixed", division: "Open", seats: [{ position: 1, userId: "a", fullName: "A", email: "a@example.com" }, { position: 2, userId: "b", fullName: "B", email: "b@example.com" }] };
function database() {
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: "training" }]), competitor: { findFirst: vi.fn().mockResolvedValue(null) }, seriesParticipant: { update: vi.fn() }, team: { findFirst: vi.fn().mockResolvedValue({ number: 103 }), create: vi.fn().mockResolvedValue({ id: "new", number: 104, name: "Pair" }) } };
  const db = { $transaction: vi.fn(async fn => fn(tx)) };
  return { db, tx };
}
beforeEach(() => { vi.resetAllMocks(); });
describe("one team per athlete per competition", () => {
  it("claims the competition before checking duplicates and commits team and partners together", async () => {
    const { db, tx } = database(); await expect(createTeam(db as never, input)).resolves.toMatchObject({ ok: true, number: 104 });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.competitor.findFirst.mock.invocationCallOrder[0]);
    expect(tx.competitor.findFirst.mock.calls[0][0].where.team.seriesId).toBe("training");
    expect(mocks.link).toHaveBeenCalledWith("a", "b", "training", tx);
    expect(tx.team.create.mock.calls[0][0].data.competitors.create.map((s: { userId: string }) => s.userId)).toEqual(["a", "b"]);
  });
  it("refuses an existing athlete in this competition and writes nothing", async () => {
    const { db, tx } = database(); tx.competitor.findFirst.mockResolvedValue({ id: "existing" });
    await expect(createTeam(db as never, input)).resolves.toEqual({ ok: false, error: "ALREADY_ENTERED" });
    expect(mocks.ensure).not.toHaveBeenCalled(); expect(tx.team.create).not.toHaveBeenCalled();
  });
  it("does not leave a team behind if another partner wins the race", async () => {
    const { db, tx } = database(); mocks.link.mockRejectedValue(new Error("ALREADY_LINKED"));
    await expect(createTeam(db as never, input)).resolves.toEqual({ ok: false, error: "HAS_OTHER_PARTNER" });
    expect(tx.team.create).not.toHaveBeenCalled();
  });
  it("rejects the same email in both seats even with different account ids", async () => {
    const { db } = database(); const duplicate = { ...input, seats: [input.seats[0], { ...input.seats[1], email: "A@EXAMPLE.COM" }] };
    await expect(createTeam(db as never, duplicate)).resolves.toEqual({ ok: false, error: "ALREADY_ENTERED" }); expect(db.$transaction).not.toHaveBeenCalled();
  });
});
