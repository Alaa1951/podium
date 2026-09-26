"use server";

import { AUDIT, recordAudit } from "@/lib/audit";
import { crmSyncEnabled, runSync, SYNC_STATE_ID } from "@/lib/crm/sync";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { isBft, requireAccess } from "@/lib/session";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// SYNC NOW.
//
// The poll runs every fifteen minutes, which is fine until the morning of a
// competition: somebody pays at the door, it is taken in the CRM, and a pair
// stands there while a timer counts down. This is the button that skips the
// wait — nothing more. It runs the same `runSync` on the same claim, so
// pressing it while a poll is already running is answered honestly rather
// than starting a second one.
//
// IT REUSES `registrations.create` rather than adding a permission key.
// A new key has to be written into every system role by the migration or the
// feature ships INVISIBLE to everyone except an admin — and the admin is the
// person testing it, so it looks like it works. That has happened twice here.
// This action creates registrations, so the key already fits.
// ─────────────────────────────────────────────────────────────────────────────

export async function syncCrmNow(): Promise<ActionResult> {
  const actor = await requireAccess("registrations.create");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  // The sync is the whole CRM, every gym's intake at once: BFT MENA's button.
  // Gyms hold registrations.create for their own entries, not for this.
  if (!isBft(actor)) return { ok: false, error: "FORBIDDEN" };
  if (!crmSyncEnabled()) return { ok: false, error: "DISABLED" };

  const result = await runSync();

  if (result.busy) return { ok: false, error: "BUSY" };
  if (!result.ok) return { ok: false, error: result.error ?? "FAILED" };

  // The refresh happens HERE and not in `runSync`, because `revalidatePath`
  // only works inside a request and the fifteen-minute timer has none. The
  // timer's work is picked up on the next page load instead.
  if (result.created > 0 || result.updated > 0) revalidateCompetitionViews();

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.crmSyncRun,
    targetType: "event",
    targetId: SYNC_STATE_ID,
    targetLabel: "CRM sync",
    detail: `created ${result.created}, updated ${result.updated}, waiting ${result.waiting}, skipped ${result.skipped}`,
  });

  return {
    ok: true,
    message: `Created ${result.created}, updated ${result.updated}, ${result.waiting} not teams yet.`,
  };
}
