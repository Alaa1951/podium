/**
 * Closing your own account. The properties worth pinning are the two that
 * cannot be recovered from if they are wrong: an admin preview must not be
 * able to close somebody else's account, and the last way into the platform
 * must not be closable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  countUsers: vi.fn(),
  updateUser: vi.fn(),
  cancelRequests: vi.fn(),
  revoke: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { count: mocks.countUsers, update: mocks.updateUser },
    partnerRequest: { updateMany: mocks.cancelRequests },
  },
}));
vi.mock("@/lib/trusted-device", () => ({ revokeTrustedDevices: mocks.revoke }));
vi.mock("@/lib/audit", () => ({
  recordAudit: mocks.audit,
  AUDIT: { accountSelfDeleted: "user.self_deleted" },
}));

import { deleteOwnAccount } from "@/lib/actions/my-account";

const athlete = { id: "u1", email: "runner@example.com", role: "competitor" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.updateUser.mockResolvedValue({});
  mocks.cancelRequests.mockResolvedValue({ count: 0 });
  mocks.revoke.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
});

describe("deleting your own account", () => {
  it("archives and disables the row, kills trusted devices, and leaves an audit", async () => {
    mocks.user.mockResolvedValue(athlete);

    expect(await deleteOwnAccount()).toEqual({ ok: true });

    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { archivedAt: expect.any(Date), status: "disabled" },
    });
    expect(mocks.revoke).toHaveBeenCalledWith({ userId: "u1", reason: "account_deleted" });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "u1", action: "user.self_deleted", targetId: "u1" })
    );
  });

  it("never hard-deletes — the row is kept so a run competition stays answerable", async () => {
    mocks.user.mockResolvedValue(athlete);

    await deleteOwnAccount();

    expect(mocks.updateUser).toHaveBeenCalledOnce();
    // There is no delete on the mocked client at all: calling one would throw.
    expect(mocks.updateUser.mock.calls[0][0].data).not.toHaveProperty("email", null);
  });

  it("cancels open partner requests, so none is left unanswerable", async () => {
    mocks.user.mockResolvedValue(athlete);

    await deleteOwnAccount();

    expect(mocks.cancelRequests).toHaveBeenCalledWith({
      where: { status: "pending", OR: [{ fromUserId: "u1" }, { toUserId: "u1" }] },
      data: { status: "cancelled", openPairKey: null, respondedAt: expect.any(Date) },
    });
  });

  it("refuses a signed-out caller", async () => {
    mocks.user.mockResolvedValue(null);

    expect(await deleteOwnAccount()).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("refuses an admin looking through somebody else's eyes", async () => {
    mocks.user.mockResolvedValue({ ...athlete, viewAs: { byAdminId: "boss" } });

    expect(await deleteOwnAccount()).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("refuses the only administrator — nobody would be left to restore anything", async () => {
    mocks.user.mockResolvedValue({ id: "a1", email: "boss@bftmena.com", role: "admin" });
    mocks.countUsers.mockResolvedValue(0);

    expect(await deleteOwnAccount()).toEqual({ ok: false, error: "LAST_ADMIN" });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("lets an administrator go when another active one remains", async () => {
    mocks.user.mockResolvedValue({ id: "a1", email: "boss@bftmena.com", role: "admin" });
    mocks.countUsers.mockResolvedValue(1);

    expect(await deleteOwnAccount()).toEqual({ ok: true });
    expect(mocks.countUsers).toHaveBeenCalledWith({
      where: { role: "admin", status: "active", archivedAt: null, id: { not: "a1" } },
    });
    expect(mocks.updateUser).toHaveBeenCalledOnce();
  });
});
