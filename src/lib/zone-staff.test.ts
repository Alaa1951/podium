import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ roles: vi.fn(), people: vi.fn(), posts: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  accessRole: { findMany: mocks.roles },
  user: { findMany: mocks.people },
  zoneStaff: { findMany: mocks.posts },
} }));

import { hasLiveZonePost, judgeCandidates } from "@/lib/zone-staff";

const judgeRole = { key: "judge", name: "Judge", permissions: ["judgeSheet.view", "scores.enter"] };
const leaderRole = { key: "zone-leaders", name: "Zone Leaders", permissions: ["judgeSheet.leaderView", "scores.enter"] };
const person = (id: string, accessRole = leaderRole, permissionOverrides: unknown = null) => ({
  id, name: id, email: `${id}@example.com`, role: "organiser", permissionOverrides,
  accessRoles: [{ accessRole }],
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.roles.mockResolvedValue([judgeRole, leaderRole]);
  mocks.people.mockResolvedValue([]);
});

describe("zone staff candidate eligibility", () => {
  it("includes role-only leaders for leader positions and judges for both", async () => {
    mocks.people.mockResolvedValue([person("leader"), person("judge", judgeRole)]);
    expect(await judgeCandidates()).toEqual([
      expect.objectContaining({ id: "leader", canJudge: false, canLead: true }),
      expect.objectContaining({ id: "judge", canJudge: true, canLead: true }),
    ]);
    expect(mocks.people).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "active", archivedAt: null, approvalStatus: "approved" }),
    }));
  });

  it("honors locks on either scoring permission", async () => {
    mocks.people.mockResolvedValue([
      person("blocked-enter", leaderRole, { deny: ["scores.enter"] }),
      person("blocked-sheet", leaderRole, { deny: ["judgeSheet.leaderView"] }),
    ]);
    expect(await judgeCandidates()).toEqual([]);
  });

  it("recognizes personal grants and combines separate held roles", async () => {
    const noRoles = { ...person("granted"), accessRoles: [], permissionOverrides: { grant: ["judgeSheet.leaderView", "scores.enter"] } };
    const combined = { ...person("combined"), accessRoles: [
      { accessRole: { key: "sheet", name: "Sheet", permissions: ["judgeSheet.leaderView"] } },
      { accessRole: { key: "entry", name: "Entry", permissions: ["scores.enter"] } },
    ] };
    mocks.people.mockResolvedValue([noRoles, combined]);
    expect(await judgeCandidates()).toEqual([
      expect.objectContaining({ id: "granted", canJudge: false, canLead: true }),
      expect.objectContaining({ id: "combined", canJudge: false, canLead: true }),
    ]);
  });

  it("reads the stored default role without replacing its custom permissions", async () => {
    mocks.roles.mockResolvedValue([{ key: "bft-partial", name: "Partial", permissions: ["judgeSheet.leaderView", "scores.enter"] }]);
    mocks.people.mockResolvedValue([{ ...person("default"), role: "staff", accessRoles: [] }]);
    expect(await judgeCandidates()).toEqual([expect.objectContaining({ id: "default", canJudge: false, canLead: true })]);
  });
});

describe("sheet home for live zone posts", () => {
  const now = new Date("2026-10-03T10:00:00Z");
  const user = { role: "organiser" as const, permissions: ["judgeSheet.leaderView", "scores.enter"] };
  const post = (position: string, status = "live", competitionDate = new Date("2026-10-03T00:00:00Z")) => ({ position, series: { status, competitionDate } });

  it("does not treat stale judge and reserve assignments as a leader home", async () => {
    mocks.posts.mockResolvedValue([post("judge"), post("reserve")]);
    expect(await hasLiveZonePost("leader", now, user)).toBe(false);
  });

  it("lands on the leader sheet for a running competition or a scheduled day today", async () => {
    mocks.posts.mockResolvedValue([post("leader")]);
    expect(await hasLiveZonePost("leader", now, user)).toBe(true);
    mocks.posts.mockResolvedValue([post("leader", "scheduled")]);
    expect(await hasLiveZonePost("leader", now, user)).toBe(true);
    mocks.posts.mockResolvedValue([post("leader", "scheduled", new Date("2026-10-04T00:00:00Z"))]);
    expect(await hasLiveZonePost("leader", now, user)).toBe(false);
  });
});
