import "server-only";

import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";
import { getIpFromHeaders } from "@/lib/security";

// The record of who was allowed to do what. Written from server actions and
// route handlers only — never from anything a browser can reach directly.
//
// Auditing must never be the reason a legitimate action fails, so every write
// here is best-effort and swallows its own errors after logging them.

export const AUDIT = {
  waveScheduleChanged: "wave.schedule_changed",
  waveChangeRequested: "wave.change_requested",
  waveChangeApproved: "wave.change_approved",
  waveChangeRejected: "wave.change_rejected",
  accountInvited: "account.invited",
  accountReinvited: "account.reinvited",
  accountEnabled: "account.enabled",
  accountDisabled: "account.disabled",
  accountStudioAssigned: "account.studio_assigned",
  accountUpdated: "account.updated",
  resetLinkSent: "account.reset_link_sent",
  studioRenamed: "studio.renamed",
  scoreUnlocked: "score.unlocked",
  eventStatusChanged: "event.status_changed",
  wavesAssigned: "event.waves_assigned",
  waveControlled: "event.wave_controlled",
  registrationCreated: "registration.created",
  /** A CRM poll somebody asked for by hand; the timer's polls are not audited. */
  crmSyncRun: "crm.sync_run",
  crmRegistrationCompleted: "crm.registration_completed",
  registrationUpdated: "registration.updated",
  paymentChanged: "registration.payment_changed",
  attendanceChanged: "registration.attendance_changed",
  zoneChanged: "config.zone_changed",
  seriesCreated: "series.created",
  seriesSettingsChanged: "series.settings_changed",
  seriesStatusChanged: "series.status_changed",
  seriesPublishedChanged: "series.publish_changed",
  seriesStudioChanged: "series.studio_changed",
  seriesSponsorChanged: "series.sponsor_changed",
  studioAdded: "studio.added",
  teamDeleted: "team.deleted",
  teamArchived: "team.archived",
  teamRestored: "team.restored",
  userArchived: "user.archived",
  userRestored: "user.restored",
  accountSelfDeleted: "user.self_deleted",
  seriesArchived: "series.archived",
  seriesRestored: "series.restored",
  waveAccessGranted: "wave.access_granted",
  waveAccessRevoked: "wave.access_revoked",
  zoneStaffChanged: "zone.staff_changed",
  zoneScoreSaved: "zone.score_saved",
  accessRoleChanged: "access.role_changed",
  accessRoleAssigned: "access.role_assigned",
  accessRoleRemoved: "access.role_removed",
  accessOverridesChanged: "access.overrides_changed",
  signupApproved: "signup.approved",
  signupRejected: "signup.rejected",
  devicesRevoked: "security.devices_revoked",
  passwordChanged: "security.password_changed",
  passwordResetRequested: "security.password_reset_requested",
  partnerRequestSent: "partner.request_sent",
  partnerRequestAccepted: "partner.request_accepted",
  partnerRequestDeclined: "partner.request_declined",
  partnerRequestWithdrawn: "partner.request_withdrawn",
  partnerUnlinked: "partner.unlinked",
  teamMemberSwapped: "team.member_swapped",
  waitlistAdmitted: "registration.waitlist_admitted",
  waitlistReturned: "registration.waitlist_returned",
  announcementSent: "notification.sent",
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];

export async function recordAudit(entry: {
  actorId: string;
  action: AuditAction;
  targetType: "user" | "team" | "event" | "studio" | "score" | "notification";
  targetId: string;
  targetLabel?: string | null;
  detail?: string | null;
}) {
  try {
    const requestHeaders = await headers();
    await prisma.adminAuditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        targetLabel: entry.targetLabel ?? null,
        detail: entry.detail ?? null,
        ip: getIpFromHeaders(requestHeaders),
      },
    });
  } catch (error) {
    console.error("[AUDIT] write failed", error instanceof Error ? error.message : error);
  }
}

export async function listAudit(limit = 50) {
  return prisma.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      targetLabel: true,
      detail: true,
      createdAt: true,
      ip: true,
      actor: { select: { name: true, email: true, role: true } },
    },
  });
}
