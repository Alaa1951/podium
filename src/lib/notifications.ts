import "server-only";

import { DEFAULT_STUDIO_PERMISSIONS, type CurrentUser } from "@/lib/access";
import { notificationScope } from "@/lib/notification-access";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

/** Re-read status, role and studio: a JWT may outlive an account scope change. */
export async function getNotificationUser(): Promise<CurrentUser | null> {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) return null;
  const account = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { status: true, archivedAt: true, role: true, studioId: true, accessRoleId: true },
  });
  if (!account || account.status !== "active" || account.archivedAt) return null;
  const permissions = account.role === "admin" ? ["*"] : account.role === "studio" ? DEFAULT_STUDIO_PERMISSIONS : [];
  const customRole = account.accessRoleId
    ? await prisma.accessRole.findUnique({ where: { id: account.accessRoleId }, select: { permissions: true } })
    : null;
  return {
    ...sessionUser,
    role: account.role,
    studioId: account.studioId,
    permissions: account.accessRoleId ? (customRole?.permissions as string[] | undefined) ?? [] : permissions,
  };
}

export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
};
export type NotificationFeed = {
  items: NotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
  readOnly: boolean;
  scopeKey: string;
};

export async function listNotifications(user: CurrentUser, cursor?: string): Promise<NotificationFeed | null> {
  const where = notificationScope(user);
  if (cursor && !await prisma.notification.findFirst({ where: { AND: [where, { id: cursor }] }, select: { id: true } })) return null;
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, title: true, body: true, createdAt: true,
        reads: { where: { userId: user.id }, select: { userId: true } },
      },
    }),
    prisma.notification.count({ where: { AND: [where, { reads: { none: { userId: user.id } } }] } }),
  ]);
  return {
    items: rows.slice(0, 20).map((row) => ({ id: row.id, title: row.title, body: row.body, createdAt: row.createdAt.toISOString(), read: row.reads.length > 0 })),
    unreadCount,
    nextCursor: rows.length > 20 ? rows[19].id : null,
    readOnly: !!user.viewAs,
    scopeKey: JSON.stringify([user.id, user.role, user.studioId, !!user.viewAs]),
  };
}

export async function markVisibleNotificationsRead(user: CurrentUser, ids: string[]) {
  if (user.viewAs) throw new Error("PREVIEW_READ_ONLY");
  const visible = await prisma.notification.findMany({
    where: { AND: [notificationScope(user), { id: { in: ids } }] },
    select: { id: true },
  });
  await prisma.notificationRead.createMany({
    data: visible.map(({ id }) => ({ notificationId: id, userId: user.id })),
    skipDuplicates: true,
  });
}
