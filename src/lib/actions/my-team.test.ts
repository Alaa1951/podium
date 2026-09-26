import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), seat: vi.fn(), roster: vi.fn(), update: vi.fn(), tx: vi.fn(), door: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { competitor: { findFirst: mocks.seat, findMany: mocks.roster, updateMany: mocks.update }, $transaction: mocks.tx } }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/security", () => ({ normalizeEmail: (s: string) => s.trim().toLowerCase(), isValidEmail: () => true }));
vi.mock("@/lib/visibility", () => ({ teamEditOpen: mocks.door }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { updateMyTeam } from "./my-team";
const members = [{ position: 1, fullName: "Athlete", email: "a@example.com" }];
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "a", role: "competitor", permissions: ["athleteHome.editTeam"] }); mocks.door.mockReturnValue({ open: true });
  mocks.seat.mockResolvedValue({ teamId: "target-team", team: { series: { competitionDate: new Date("2099-01-01"), teamEditCloseHours: 24 } } });
  mocks.roster.mockResolvedValue([{ id: "seat", position: 1, userId: "a", fullName: "Old snapshot", email: "a@example.com", user: { name: "Athlete", email: "a@example.com" } }]);
  mocks.tx.mockImplementation(async fn => fn({ $queryRaw: vi.fn(), competitor: { updateMany: mocks.update } }));
});
it("checks both team and selected competition against the signed-in account", async () => {
  mocks.seat.mockResolvedValue(null);
  expect(await updateMyTeam(members, "training", "source-team")).toEqual({ ok: false, error: "FORBIDDEN" });
  expect(mocks.seat.mock.calls[0][0].where).toMatchObject({ userId: "a", teamId: "source-team", team: { seriesId: "training" } });
  expect(mocks.tx).not.toHaveBeenCalled();
});
it("refuses changing a shared account's name from a training team form", async () => {
  expect(await updateMyTeam([{ ...members[0], fullName: "Pretend person" }], "training", "target-team")).toEqual({ ok: false, error: "SHARED_PROFILE" });
  expect(mocks.tx).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
it("leaves shared identities and original seat snapshots untouched for unchanged fields", async () => {
  expect(await updateMyTeam(members, "training", "target-team")).toEqual({ ok: true }); expect(mocks.update).not.toHaveBeenCalled();
});
it("refuses view-as and a closed edit deadline", async () => {
  mocks.user.mockResolvedValue({ id: "a", role: "competitor", permissions: ["athleteHome.editTeam"], viewAs: {} });
  expect(await updateMyTeam(members, "training", "target-team")).toEqual({ ok: false, error: "FORBIDDEN" });
  mocks.user.mockResolvedValue({ id: "a", role: "competitor", permissions: ["athleteHome.editTeam"] }); mocks.door.mockReturnValue({ open: false });
  expect(await updateMyTeam(members, "training", "target-team")).toEqual({ ok: false, error: "TEAM_EDIT_CLOSED" });
});
it("refuses an athlete whose roles no longer carry athleteHome.editTeam", async () => {
  mocks.user.mockResolvedValue({ id: "a", role: "competitor", permissions: [] });
  expect(await updateMyTeam(members, "training", "target-team")).toEqual({ ok: false, error: "FORBIDDEN" });
  expect(mocks.seat).not.toHaveBeenCalled();
});
