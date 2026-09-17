import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrentUser } from "@/lib/access";
import { notificationScope } from "@/lib/notification-access";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), account: vi.fn(), accessRole: vi.fn(), rows: vi.fn(), cursor: vi.fn(), count: vi.fn(), receipts: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.session }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findUnique: mocks.account }, accessRole: { findUnique: mocks.accessRole },
  notification: { findMany: mocks.rows, findFirst: mocks.cursor, count: mocks.count }, notificationRead: { createMany: mocks.receipts },
} }));

import { getNotificationUser, listNotifications, markVisibleNotificationsRead } from "@/lib/notifications";

const user: CurrentUser = { id: "u1", email: "competitor@example.test", name: null, role: "competitor", studioId: "studio1", locale: "en", permissions: [] };
beforeEach(() => vi.resetAllMocks());

describe("fresh account authority", () => {
  it("refuses disabled or archived accounts even with an active token", async () => {
    mocks.session.mockResolvedValue(user);
    mocks.account.mockResolvedValue({ status: "disabled" });
    expect(await getNotificationUser()).toBeNull();
    mocks.account.mockResolvedValue({ status: "active", archivedAt: new Date() });
    expect(await getNotificationUser()).toBeNull();
  });
  it("uses the database studio and permission profile after a scope change", async () => {
    mocks.session.mockResolvedValue({ ...user, role: "studio", studioId: "old", permissions: ["announcements.manage"] });
    mocks.account.mockResolvedValue({ status: "active", archivedAt: null, role: "studio", studioId: "new", accessRoleId: "restricted" });
    mocks.accessRole.mockResolvedValue({ permissions: ["announcements.view"] });
    expect(await getNotificationUser()).toMatchObject({ studioId: "new", permissions: ["announcements.view"] });
  });
});

describe("recipient reads", () => {
  it("filters both inbox content and unread count and reads only this account's receipts", async () => {
    mocks.rows.mockResolvedValue([{ id: "n1", title: "Hello", body: "Body", createdAt: new Date("2026-09-17T00:00:00Z"), reads: [] }]);
    mocks.count.mockResolvedValue(1);
    const result = await listNotifications(user);
    expect(mocks.rows).toHaveBeenCalledWith(expect.objectContaining({ where: notificationScope(user), select: expect.objectContaining({ reads: { where: { userId: "u1" }, select: { userId: true } } }) }));
    expect(mocks.count).toHaveBeenCalledWith({ where: { AND: [notificationScope(user), { reads: { none: { userId: "u1" } } }] } });
    expect(result).toMatchObject({ unreadCount: 1, items: [{ id: "n1", read: false }], nextCursor: null });
  });
  it("refuses a cursor outside the recipient's audience", async () => {
    mocks.cursor.mockResolvedValue(null);
    expect(await listNotifications(user, "private-other-studio")).toBeNull();
    expect(mocks.rows).not.toHaveBeenCalled();
  });
  it("creates idempotent receipts only for visible IDs and the server's user ID", async () => {
    mocks.rows.mockResolvedValue([{ id: "public" }]);
    await markVisibleNotificationsRead(user, ["public", "other-studio"]);
    expect(mocks.rows).toHaveBeenCalledWith({ where: { AND: [notificationScope(user), { id: { in: ["public", "other-studio"] } }] }, select: { id: true } });
    expect(mocks.receipts).toHaveBeenCalledWith({ data: [{ notificationId: "public", userId: "u1" }], skipDuplicates: true });
  });
  it("does not write receipts during an admin preview", async () => {
    await expect(markVisibleNotificationsRead({ ...user, viewAs: { byAdminId: "admin" } }, ["n1"])).rejects.toThrow("PREVIEW_READ_ONLY");
    expect(mocks.receipts).not.toHaveBeenCalled();
  });
});
