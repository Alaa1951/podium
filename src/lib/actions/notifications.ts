"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { announcementSchema, canSendAnnouncement } from "@/lib/notification-access";
import { getNotificationUser, markVisibleNotificationsRead } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { checkRate, MINUTE_MS } from "@/lib/rate-limit";

export type NotificationActionResult = { ok: true } | { ok: false; error: "FORBIDDEN" | "INVALID_INPUT" | "TRY_LATER" | "FAILED" };

export async function sendAnnouncement(input: unknown): Promise<NotificationActionResult> {
  const actor = await getNotificationUser();
  const parsed = announcementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  if (!actor || !canSendAnnouncement(actor, parsed.data)) return { ok: false, error: "FORBIDDEN" };
  const data = parsed.data;
  if (data.audience === "studio") {
    const studio = await prisma.studio.findFirst({ where: { id: data.audienceStudioId, isActive: true }, select: { id: true } });
    if (!studio) return { ok: false, error: "INVALID_INPUT" };
  }
  if (!checkRate(`announcements:${actor.id}`, 10, MINUTE_MS).ok) return { ok: false, error: "TRY_LATER" };
  try {
    const notification = await prisma.notification.create({
      data: {
        title: data.title, body: data.body, audience: data.audience,
        audienceRole: data.audience === "role" ? data.audienceRole : null,
        audienceStudioId: data.audience === "studio" ? data.audienceStudioId : null,
        createdBy: actor.id,
      },
      select: { id: true },
    });
    await recordAudit({ actorId: actor.id, action: AUDIT.announcementSent, targetType: "notification", targetId: notification.id, targetLabel: data.title, detail: JSON.stringify({ audience: data.audience, audienceRole: data.audience === "role" ? data.audienceRole : null, audienceStudioId: data.audience === "studio" ? data.audienceStudioId : null }) });
    revalidatePath("/announcements");
    revalidatePath("/studio/announcements");
    return { ok: true };
  } catch (error) {
    console.error("[NOTIFICATIONS] send failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "FAILED" };
  }
}

const idsSchema = z.array(z.string().min(1).max(191)).min(1).max(100);

export async function markNotificationsRead(input: unknown): Promise<NotificationActionResult> {
  const user = await getNotificationUser();
  if (!user || user.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = idsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  try {
    await markVisibleNotificationsRead(user, [...new Set(parsed.data)]);
    return { ok: true };
  } catch (error) {
    console.error("[NOTIFICATIONS] read failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "FAILED" };
  }
}
