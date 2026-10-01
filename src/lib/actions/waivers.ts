"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { can, isBft } from "@/lib/access";
import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { getCurrentUser } from "@/lib/session";
import { ScheduleError, scheduleError } from "@/lib/wave-schedule";
import { scheduleTransaction } from "@/lib/wave-schedule-db";
import { attachRelease, signWaiver, type SignError } from "@/lib/waivers/waiver-db";

// ─────────────────────────────────────────────────────────────────────────────
// The waiver's buttons:
//
//   signMyWaiver       "Agree & Sign" — the athlete, for themselves only.
//   attachWaiver       BFT MENA (`waivers.manage`) makes a bundled version the
//                      one a competition requires.
//
// There is no action that signs for somebody else: staff can help an athlete
// find their page, and that is all.
// ─────────────────────────────────────────────────────────────────────────────

export type SignActionResult =
  | { ok: true; acceptanceId: string; already: boolean }
  | { ok: false; error: SignError | "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_INPUT"; currentVersion?: number };

const signSchema = z.object({
  seriesId: z.string().min(1).max(191),
  releaseId: z.string().min(1).max(191),
  language: z.enum(["en", "ar"]),
  typedName: z.string().max(400),
  agreed: z.boolean(),
});

export async function signMyWaiver(input: unknown): Promise<SignActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "UNAUTHENTICATED" };
  // Viewing as somebody is looking, never signing in their place.
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const result = await signWaiver(prisma, actor.id, parsed.data);
  if (!result.ok) return result;
  if (!result.already) {
    // What was signed, never the typed signature itself.
    await recordAudit({
      actorId: actor.id, action: AUDIT.waiverSigned, targetType: "team", targetId: result.team.id, targetLabel: result.team.label,
      detail: `waiver version ${result.version} signed (${result.language === "ar" ? "Arabic" : "English"} edition)`,
    });
    revalidateCompetitionViews();
  }
  revalidatePath("/waivers");
  return { ok: true, acceptanceId: result.acceptanceId, already: result.already };
}

export type WaiverAdminResult = { ok: true; version?: number } | { ok: false; error: string };

const mayManage = (actor: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) =>
  !actor.viewAs && isBft(actor) && can(actor, "waivers.manage");

export async function attachWaiver(input: unknown): Promise<WaiverAdminResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "UNAUTHENTICATED" };
  if (!mayManage(actor)) return { ok: false, error: "FORBIDDEN" };
  const parsed = z.object({ seriesId: z.string().min(1).max(191), documentKey: z.string().min(1).max(80), version: z.number().int().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const data = parsed.data;
  let outcome: Awaited<ReturnType<typeof attachRelease>>;
  let name = "";
  try {
    // Under the competition's lock: a wave cannot start half-way through a version change.
    outcome = await scheduleTransaction(data.seriesId, async (tx) => {
      const series = await tx.series.findUnique({ where: { id: data.seriesId }, select: { name: true, status: true, archivedAt: true } });
      if (!series || series.archivedAt) throw new ScheduleError("NOT_FOUND");
      if (series.status === "final") throw new ScheduleError("SERIES_FINISHED");
      name = series.name;
      return attachRelease(tx, { seriesId: data.seriesId, documentKey: data.documentKey, version: data.version, actorId: actor.id });
    });
  } catch (error) {
    return scheduleError(error);
  }
  if (!outcome.ok) return outcome;
  await recordAudit({
    actorId: actor.id, action: AUDIT.waiverAttached, targetType: "event", targetId: data.seriesId, targetLabel: name,
    detail: `waiver version ${outcome.release.version} (${data.documentKey} v${data.version}) required${outcome.retired ? `; version ${outcome.retired} retired — its signatures are kept, athletes sign the new version` : ""}`,
  });
  revalidateCompetitionViews();
  revalidatePath("/waivers");
  return { ok: true, version: outcome.release.version };
}
