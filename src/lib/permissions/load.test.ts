import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({ user: vi.fn(), role: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findUnique: mocks.user }, accessRole: { findUnique: mocks.role },
} }));

import { loadAccessInputs, loadPermissions } from "@/lib/permissions/load";

const row = { approvalStatus: "approved", permissionOverrides: null, accessRoles: [
  { accessRole: { key: "zone-leaders", name: "Zone Leaders", permissions: ["judgeSheet.leaderView", "scores.enter"] } },
] };

beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue(row); });

describe("permission reads through score transaction", () => {
  it("uses the provided transaction for roles and personal locks", async () => {
    const txUser = vi.fn().mockResolvedValue({ ...row, permissionOverrides: { deny: ["scores.enter"] } });
    const tx = { user: { findUnique: txUser } } as unknown as Prisma.TransactionClient;
    expect(await loadPermissions("leader", "organiser", tx)).toContain("judgeSheet.leaderView");
    expect(await loadPermissions("leader", "organiser", tx)).not.toContain("scores.enter");
    expect(txUser).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "leader" } }));
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it("uses the same transaction for the stored default role", async () => {
    const txUser = vi.fn().mockResolvedValue({ ...row, accessRoles: [] });
    const txRole = vi.fn().mockResolvedValue({ key: "bft-partial", name: "Custom Partial", permissions: ["scores.enter"] });
    const tx = { user: { findUnique: txUser }, accessRole: { findUnique: txRole } } as unknown as Prisma.TransactionClient;
    const input = await loadAccessInputs("staff", "staff", tx);
    expect(input.roles).toEqual([{ key: "bft-partial", name: "Custom Partial", permissions: ["scores.enter"] }]);
    expect(txRole).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "bft-partial" } }));
    expect(mocks.role).not.toHaveBeenCalled();
  });

  it("preserves ordinary callers without a transaction argument", async () => {
    expect(await loadPermissions("leader", "organiser")).toEqual(expect.arrayContaining(["judgeSheet.leaderView", "scores.enter"]));
    expect(mocks.user).toHaveBeenCalled();
  });
});
