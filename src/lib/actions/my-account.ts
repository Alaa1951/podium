"use server";

import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { revokeTrustedDevices } from "@/lib/trusted-device";

// ─────────────────────────────────────────────────────────────────────────────
// CLOSING YOUR OWN ACCOUNT.
//
// Every account holder can do this from their own account screen, without
// asking anyone — a requirement of the mobile app stores, and the right of
// whoever owns the account in any case.
//
// It takes the same route an administrator's "remove from the platform" takes
// (accounts.ts archiveAccount): the row is archived and disabled rather than
// dropped. A competitor's scores, a judge's submissions and the audit trail
// are other people's records as much as this account's, and a DELETE would
// tear holes in a competition that has already been run. The token refresh in
// auth.ts reads `archivedAt` and shuts the session inside five minutes; the
// screen signs out immediately, so the door closes at once either way.
// ─────────────────────────────────────────────────────────────────────────────

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; error: "FORBIDDEN" | "LAST_ADMIN" | "FAILED" };

export async function deleteOwnAccount(): Promise<DeleteAccountResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "FORBIDDEN" };

  // An admin looking through somebody else's eyes must never be able to close
  // their account — view-as is read-only everywhere else too (proxy.ts).
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };

  // Closing the last way in is not a recoverable state: nobody would be left
  // who could restore anything, this account included.
  if (user.role === "admin") {
    const otherAdmins = await prisma.user.count({
      where: { role: "admin", status: "active", archivedAt: null, id: { not: user.id } },
    });
    if (otherAdmins === 0) return { ok: false, error: "LAST_ADMIN" };
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { archivedAt: new Date(), status: "disabled" },
    });
  } catch (error) {
    console.error("[ACCOUNT:delete]", error instanceof Error ? error.message : error);
    return { ok: false, error: "FAILED" };
  }

  // Trusted browsers have to stop being trusted now, not at the next refresh.
  await revokeTrustedDevices({ userId: user.id, reason: "account_deleted" });

  await recordAudit({
    actorId: user.id,
    action: AUDIT.accountSelfDeleted,
    targetType: "user",
    targetId: user.id,
    targetLabel: user.email,
  });

  return { ok: true };
}
