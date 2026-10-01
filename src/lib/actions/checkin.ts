"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { setAthleteArrival, setWarmupReady, type CheckInOutcome } from "@/lib/checkin-db";
import { prisma } from "@/lib/prisma";
import type { TeamGaps } from "@/lib/readiness";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { getCurrentUser } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// The buttons on the two check-in screens that are not "check the whole team
// in" (that one is setAttendance, actions/payments.ts, where it has always
// lived):
//
//   setAthleteAttendance   ENTRANCE — one person has arrived, or has not;
//   setWarmupReadiness     WARM-UP  — a team is ready to compete, or is not.
//
// Two separate actions writing two separate facts: neither can change the
// other's. The key, the scope and the write are checkin-db.ts; a judge, a
// coach, an athlete — anybody without the key — is answered FORBIDDEN there.
// Answered, never redirected: they are pressed from a list that must stay put.
// ─────────────────────────────────────────────────────────────────────────────

export type CheckInActionResult =
  | { ok: true }
  /** PREREQUISITES: `gaps` names what is missing, by athlete (readiness.ts). */
  | { ok: false; error: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "SERIES_FINISHED" | "PREREQUISITES"; gaps?: TeamGaps };

async function finish(
  actorId: string,
  action: typeof AUDIT.attendanceChanged | typeof AUDIT.warmupChanged,
  outcome: CheckInOutcome
): Promise<CheckInActionResult> {
  if (!outcome.ok) return outcome;
  // A repeat changed nothing: no second audit line, nothing to refresh.
  if (!outcome.changed) return { ok: true };
  await recordAudit({
    actorId,
    action,
    targetType: "team",
    targetId: outcome.team.id,
    targetLabel: outcome.team.label,
    detail: outcome.detail,
  });
  revalidateCompetitionViews();
  return { ok: true };
}

/** One athlete arrived at the venue, or did not after all. */
export async function setAthleteAttendance(input: unknown): Promise<CheckInActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "UNAUTHENTICATED" };
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = z.object({ competitorId: z.string().min(1).max(191), attended: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  return finish(actor.id, AUDIT.attendanceChanged, await setAthleteArrival(prisma, actor, parsed.data));
}

/** A team is ready to compete — the warm-up check-in — or is not after all. */
export async function setWarmupReadiness(input: unknown): Promise<CheckInActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "UNAUTHENTICATED" };
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = z.object({ teamId: z.string().min(1).max(191), ready: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  return finish(actor.id, AUDIT.warmupChanged, await setWarmupReady(prisma, actor, parsed.data));
}
