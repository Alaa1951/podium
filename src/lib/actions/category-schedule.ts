"use server";

import { z } from "zod";

import { canBuildSchedule } from "@/lib/access";
import { AUDIT, recordAudit } from "@/lib/audit";
import { touchesProtected, validateBlockConfig, type ScheduleConflict } from "@/lib/category-schedule";
import { loadScheduleContext, planFor, ScheduleConflictError } from "@/lib/category-schedule-db";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { getCurrentUser } from "@/lib/session";
import { ScheduleError, scheduleError } from "@/lib/wave-schedule";
import { scheduleTransaction } from "@/lib/wave-schedule-db";

// ─────────────────────────────────────────────────────────────────────────────
// Settings → Category schedule: each category's start and the break after it.
//
// Building the running order is `waves.edit` on a floor account — the same
// key as Auto Assign and wave times (access.ts › canBuildSchedule); never a
// judge's, a gym's or an athlete's.
//
// Saving never moves a wave or a team: the new times take effect on the next
// Auto Assign run. A schedule that would no longer fit a team RUNNING
// MANUALLY is refused, naming the teams — somebody returns them to Auto
// Assign or moves them first. Any other conflict (a block that would
// overrun the next) is saved and reported: the preview shows it, and Auto
// Assign will not run until it is resolved.
//
// With Auto Assign switched OFF (setAutoAssign) nothing is held for it: the
// schedule is saved as typed, and the waves are timed by hand.
// ─────────────────────────────────────────────────────────────────────────────

export type CategoryScheduleResult =
  | { ok: true; conflicts: ScheduleConflict[] }
  | { ok: false; error: string; conflicts?: ScheduleConflict[] };

const schema = z.object({
  seriesId: z.string().min(1).max(191),
  blocks: z.array(z.object({
    category: z.enum(["Womens", "Mens", "Mixed"]),
    position: z.number().int().min(1).max(3),
    startTime: z.string(),
    breakMinutes: z.number().int(),
  })).length(3),
});

const describe = (blocks: { category: string; position: number; startTime: string; breakMinutes: number }[]) =>
  blocks.length
    ? [...blocks].sort((a, b) => a.position - b.position).map((block) => `${block.position}. ${block.category} ${block.startTime} +${block.breakMinutes} min`).join(", ")
    : "not set";

export async function saveCategorySchedule(input: unknown): Promise<CategoryScheduleResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "UNAUTHENTICATED" };
  if (actor.viewAs || !canBuildSchedule(actor)) return { ok: false, error: "FORBIDDEN" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const valid = validateBlockConfig(parsed.data.blocks);
  if (!valid.ok) return { ok: false, error: valid.error };
  const { seriesId } = parsed.data;

  let outcome: { before: string; after: string; conflicts: ScheduleConflict[]; name: string } | null;
  try {
    outcome = await scheduleTransaction(seriesId, async (tx) => {
      const series = await tx.series.findUnique({ where: { id: seriesId }, select: { name: true, status: true, archivedAt: true } });
      if (!series || series.archivedAt) throw new ScheduleError("NOT_FOUND");
      if (series.status === "final") throw new ScheduleError("SERIES_FINISHED");
      const context = await loadScheduleContext(tx, seriesId);
      const before = describe(context.blocks);
      const after = describe(valid.blocks);
      if (before === after) return null;
      const conflicts = planFor(context, valid.blocks).conflicts;
      const blocking = context.autoAssign ? conflicts.filter(touchesProtected) : [];
      if (blocking.length) throw new ScheduleConflictError("PROTECTED_CONFLICT", blocking);
      await tx.categorySchedule.deleteMany({ where: { seriesId } });
      await tx.categorySchedule.createMany({ data: valid.blocks.map((block) => ({ seriesId, ...block })) });
      return { before, after, conflicts, name: series.name };
    });
  } catch (error) {
    if (error instanceof ScheduleConflictError) return { ok: false, error: error.code, conflicts: error.conflicts };
    return scheduleError(error);
  }
  if (!outcome) return { ok: true, conflicts: [] };
  await recordAudit({
    actorId: actor.id, action: AUDIT.categoryScheduleChanged, targetType: "event", targetId: seriesId, targetLabel: outcome.name,
    detail: `${outcome.before} → ${outcome.after}${outcome.conflicts.length ? ` · saved with ${outcome.conflicts.length} conflict(s) to resolve before Auto Assign` : ""}`,
  });
  revalidateCompetitionViews();
  return { ok: true, conflicts: outcome.conflicts };
}

const switchSchema = z.object({ seriesId: z.string().min(1).max(191), enabled: z.boolean() });

/**
 * Settings → Category schedule › Auto Assign on or off. Off, the running
 * order is built by hand: Auto Assign does not run, and wave times, category
 * times and team moves are no longer held up by the category blocks or by
 * teams running manually. Switching moves nobody.
 */
export async function setAutoAssign(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "UNAUTHENTICATED" };
  if (actor.viewAs || !canBuildSchedule(actor)) return { ok: false, error: "FORBIDDEN" };
  const parsed = switchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId, enabled } = parsed.data;
  let changed: { name: string } | null;
  try {
    changed = await scheduleTransaction(seriesId, async (tx) => {
      const series = await tx.series.findUnique({ where: { id: seriesId }, select: { name: true, status: true, archivedAt: true, autoAssignEnabled: true } });
      if (!series || series.archivedAt) throw new ScheduleError("NOT_FOUND");
      if (series.status === "final") throw new ScheduleError("SERIES_FINISHED");
      if (series.autoAssignEnabled === enabled) return null;
      await tx.series.update({ where: { id: seriesId }, data: { autoAssignEnabled: enabled } });
      return { name: series.name };
    });
  } catch (error) {
    return scheduleError(error);
  }
  if (!changed) return { ok: true };
  await recordAudit({
    actorId: actor.id, action: AUDIT.autoAssignChanged, targetType: "event", targetId: seriesId, targetLabel: changed.name,
    detail: enabled ? "Auto Assign on" : "Auto Assign off — running order built by hand",
  });
  revalidateCompetitionViews();
  return { ok: true };
}
