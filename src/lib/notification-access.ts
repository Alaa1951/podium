import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { can, type CurrentUser } from "@/lib/access";

const content = {
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(4000),
};

export const announcementSchema = z.discriminatedUnion("audience", [
  z.object({ ...content, audience: z.literal("all") }).strict(),
  z.object({ ...content, audience: z.literal("role"), audienceRole: z.enum(["admin", "studio", "competitor"]) }).strict(),
  z.object({ ...content, audience: z.literal("studio"), audienceStudioId: z.string().min(1).max(191) }).strict(),
]);
export type AnnouncementInput = z.infer<typeof announcementSchema>;

export function canComposeAnnouncements(user: CurrentUser): boolean {
  return (user.role === "admin" || (user.role === "studio" && !!user.studioId)) && can(user, "announcements.view");
}

export function canSendAnnouncement(user: CurrentUser, input: AnnouncementInput): boolean {
  if (user.viewAs || !canComposeAnnouncements(user) || !can(user, "announcements.manage")) return false;
  if (user.role === "admin") return true;
  return input.audience === "studio" && input.audienceStudioId === user.studioId;
}

/** Admin recipients also follow their audience: admin authority is for sending. */
export function notificationScope(user: Pick<CurrentUser, "role" | "studioId">): Prisma.NotificationWhereInput {
  return {
    OR: [
      { audience: "all" },
      { audience: "role", audienceRole: user.role },
      ...(user.studioId ? [{ audience: "studio" as const, audienceStudioId: user.studioId }] : []),
    ],
  };
}
