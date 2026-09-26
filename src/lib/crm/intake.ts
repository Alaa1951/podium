import "server-only";

import { crmSyncEnabled, SYNC_STATE_ID } from "@/lib/crm/sync";
import { prisma } from "@/lib/prisma";

// The CRM's work list and the last poll, for the registration screens.
//
// READS, so they live here and not in actions/crm-sync.ts: every export of a
// "use server" file is a server action anyone signed in — or not — can call
// with its id, and these return contact names, emails and phone numbers with
// no check of their own. The screens that show them gate on BFT MENA first.

/**
 * The registrations the CRM has not finished, for the work list.
 *
 * Oldest first: the useful order is who has been waiting longest, not who
 * arrived last. Returns nothing when the sync is off, so the screen is
 * exactly as it was for anyone not using the CRM.
 *
 * `waitingDays` is worked out HERE rather than on either screen. The clock
 * is impure, so reading it while rendering is both a lint error and a real
 * hazard on a client component — the server would render one number and the
 * browser hydrate with another. Doing it once also stops two screens
 * computing the same thing slightly differently.
 */
export async function crmIntakeFor(seriesId: string) {
  if (!crmSyncEnabled()) return [];
  const now = Date.now();
  const rows = await prisma.crmIntake.findMany({
    where: { seriesId },
    orderBy: { firstSeenAt: "asc" },
    select: {
      id: true,
      externalId: true,
      contactName: true,
      email: true,
      phone: true,
      partnerName: true,
      teamName: true,
      stageName: true,
      missing: true,
      firstSeenAt: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    waitingDays: Math.floor((now - row.firstSeenAt.getTime()) / 86_400_000),
  }));
}

/** What the last poll did, for the line above the registration list. */
export async function lastCrmSync() {
  if (!crmSyncEnabled()) return null;
  return prisma.crmSyncState.findUnique({
    where: { id: SYNC_STATE_ID },
    select: {
      running: true,
      lastSuccessAt: true,
      lastCreated: true,
      lastUpdated: true,
      lastWaiting: true,
      lastSkipped: true,
      lastError: true,
    },
  });
}
