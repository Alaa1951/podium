import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrentUser } from "@/lib/access";

// ─────────────────────────────────────────────────────────────────────────────
// The approval queue: who sees which sign-ups, and the rules on deciding one.
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  actor: null as unknown as CurrentUser,
  findFirstUser: vi.fn(),
  updateMany: vi.fn(),
  findRoles: vi.fn(),
  findStudio: vi.fn(),
  findStudioByName: vi.fn(),
  createStudio: vi.fn(),
  createRoles: vi.fn(),
  audit: vi.fn(),
  email: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ AUDIT: { signupApproved: "signup.approved", signupRejected: "signup.rejected" }, recordAudit: mocks.audit }));
vi.mock("@/lib/email", () => ({ sendSignupDecisionEmail: mocks.email }));
vi.mock("@/lib/security", () => ({ getBaseUrl: () => "https://podium.test" }));
vi.mock("@/lib/session", () => ({ requireAccess: async () => mocks.actor }));
// Approving an athlete may ENTER them in a competition, but that bridge has
// its own tests (enter-pair.test.ts) and running it here made this file the
// slowest in the suite — slow enough to time out under parallel load and fail
// on the clock rather than on behaviour. This file is about the DECISION.
vi.mock("@/lib/enter-pair", () => ({
  enterPairIfReady: async () => ({ entered: false, reason: "NO_COMPETITION" }),
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    user: { updateMany: mocks.updateMany },
    userAccessRole: { createMany: mocks.createRoles },
    studio: { create: mocks.createStudio },
  };
  return {
    prisma: {
      user: { findFirst: mocks.findFirstUser, updateMany: mocks.updateMany },
      accessRole: { findMany: mocks.findRoles },
      studio: { findFirst: mocks.findStudio, findUnique: mocks.findStudioByName },
      $transaction: async (work: (client: typeof tx) => unknown) => work(tx),
    },
  };
});

const person = (over: Partial<CurrentUser>): CurrentUser =>
  ({
    id: "actor",
    email: "actor@test",
    name: "Actor",
    role: "admin",
    status: "active",
    studioId: null,
    permissions: ["*"],
    viewAs: null,
    ...over,
  }) as CurrentUser;

const STUDIO_PERMS = ["approvals.view", "approvals.decide", "users.assignRoles", "users.view"];
const judgeRole = { id: "r-judge", name: "Judge", assignableBy: "bft_studio", permissions: ["judgeSheet.view", "scores.enter"] };
const bftRole = { id: "r-partial", name: "BFT MENA Partial", assignableBy: "bft", permissions: ["dashboard.view"] };
const request = {
  id: "req",
  email: "new@test",
  role: "organiser",
  signupType: "organiser",
  requestedRoleKey: "judge",
  requestedStudioId: "s1",
};

describe("approvalScope", () => {
  it("shows BFT MENA every verified, waiting sign-up", async () => {
    const { approvalScope } = await import("@/lib/approvals");
    const where = approvalScope(person({ role: "staff", permissions: ["approvals.view"] }));
    expect(where).toMatchObject({ approvalStatus: "pending", signupType: { not: null }, emailVerified: { not: null } });
    expect(where).not.toHaveProperty("requestedStudioId");
  });

  it("shows a studio only the requests naming it, never a Gym/Studio request", async () => {
    const { approvalScope } = await import("@/lib/approvals");
    const where = approvalScope(person({ role: "studio", studioId: "s1", permissions: STUDIO_PERMS }));
    expect(where).toMatchObject({ requestedStudioId: "s1" });
    expect(JSON.stringify(where)).toContain("gym-studio");
  });

  it("shows nothing without approvals.view, or to a studio with no studio", async () => {
    const { approvalScope } = await import("@/lib/approvals");
    expect(approvalScope(person({ role: "staff", permissions: [] }))).toBeNull();
    expect(approvalScope(person({ role: "organiser", permissions: ["approvals.view"] }))).toBeNull();
    expect(approvalScope(person({ role: "studio", studioId: null, permissions: STUDIO_PERMS }))).toBeNull();
  });
});

describe("approveSignup / rejectSignup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirstUser.mockResolvedValue(request);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findStudio.mockResolvedValue({ id: "s1" });
    mocks.findStudioByName.mockResolvedValue(null);
    mocks.createStudio.mockResolvedValue({ id: "s-new" });
  });

  it("lets a studio approve into itself with a role it may give", async () => {
    mocks.actor = person({ role: "studio", studioId: "s1", permissions: STUDIO_PERMS });
    mocks.findRoles.mockResolvedValue([judgeRole]);
    const { approveSignup } = await import("@/lib/actions/approvals");
    const result = await approveSignup({ userId: "req", roleIds: ["r-judge"] });
    expect(result).toEqual({ ok: true, message: "Approved." });
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ studioId: "s1", approvalStatus: "approved", approvedById: "actor" });
    expect(mocks.createRoles).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ accessRoleId: "r-judge" })] }));
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ approved: true }));
  });

  it("refuses a studio giving a BFT-only role", async () => {
    mocks.actor = person({ role: "studio", studioId: "s1", permissions: STUDIO_PERMS });
    mocks.findRoles.mockResolvedValue([bftRole]);
    const { approveSignup } = await import("@/lib/actions/approvals");
    expect(await approveSignup({ userId: "req", roleIds: ["r-partial"] })).toMatchObject({ ok: false, error: "ROLE_NOT_ASSIGNABLE" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a studio approving a Gym/Studio request", async () => {
    mocks.actor = person({ role: "studio", studioId: "s1", permissions: STUDIO_PERMS });
    mocks.findFirstUser.mockResolvedValue({ ...request, requestedRoleKey: "gym-studio" });
    mocks.findRoles.mockResolvedValue([]);
    const { approveSignup } = await import("@/lib/actions/approvals");
    expect(await approveSignup({ userId: "req", roleIds: [] })).toMatchObject({ ok: false, error: "FORBIDDEN" });
  });

  it("never lets anyone decide their own request", async () => {
    mocks.actor = person({ id: "req" });
    const { approveSignup, rejectSignup } = await import("@/lib/actions/approvals");
    expect(await approveSignup({ userId: "req", roleIds: [] })).toMatchObject({ error: "CANNOT_CHANGE_OWN_ACCESS" });
    expect(await rejectSignup({ userId: "req" })).toMatchObject({ error: "CANNOT_CHANGE_OWN_ACCESS" });
  });

  it("makes a Gym/Studio request a studio account, creating the studio", async () => {
    mocks.actor = person({});
    mocks.findFirstUser.mockResolvedValue({ ...request, requestedRoleKey: "gym-studio", requestedStudioId: null });
    mocks.findRoles.mockResolvedValue([]);
    const { approveSignup } = await import("@/lib/actions/approvals");
    const result = await approveSignup({ userId: "req", roleIds: [], studioId: null, newStudioName: "Iron Gym" });
    expect(result.ok).toBe(true);
    expect(mocks.createStudio).toHaveBeenCalledWith(expect.objectContaining({ data: { name: "Iron Gym" } }));
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ role: "studio", studioId: "s-new" });
  });

  it("reports a request someone else already decided", async () => {
    mocks.actor = person({});
    mocks.findRoles.mockResolvedValue([]);
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const { approveSignup, rejectSignup } = await import("@/lib/actions/approvals");
    expect(await approveSignup({ userId: "req", roleIds: [] })).toMatchObject({ error: "ALREADY_DECIDED" });
    expect(await rejectSignup({ userId: "req", reason: "no" })).toMatchObject({ error: "ALREADY_DECIDED" });
  });

  it("turns a request down with its reason, and emails it", async () => {
    mocks.actor = person({});
    const { rejectSignup } = await import("@/lib/actions/approvals");
    expect(await rejectSignup({ userId: "req", reason: "Unknown gym" })).toMatchObject({ ok: true });
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ approvalStatus: "rejected", rejectionReason: "Unknown gym" });
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ approved: false, reason: "Unknown gym" }));
  });

  it("refuses a preview (view-as) session", async () => {
    mocks.actor = person({ viewAs: { role: "studio" } as unknown as CurrentUser["viewAs"] });
    const { approveSignup } = await import("@/lib/actions/approvals");
    expect(await approveSignup({ userId: "req", roleIds: [] })).toMatchObject({ error: "FORBIDDEN" });
  });
});
