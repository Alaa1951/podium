"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { MAX_STATIONS } from "@/lib/floor";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { ScheduleError, scheduleError } from "@/lib/wave-schedule";
import { scheduleTransaction } from "@/lib/wave-schedule-db";
import { canBuildSchedule, canPlaceTeams } from "@/lib/access";
import type { ScheduleConflict } from "@/lib/category-schedule";
import { applyPlan, autoAssignOn, isScheduled, loadScheduleContext, planFor, ScheduleConflictError } from "@/lib/category-schedule-db";
import { getCurrentUser, requireAccess, teamScope } from "@/lib/session";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { message?: string } : { message?: string; data: T }))
  | { ok: false; error: string; conflicts?: ScheduleConflict[] };

const stationSchema = z.object({
  teamId: z.string().min(1),
  station: z.coerce.number().int().min(1).max(MAX_STATIONS),
});

/**
 * Move a team to another station of its own wave, before the wave starts —
 * a placement by hand, so the team then RUNS MANUALLY (protected from Auto
 * Assign). If a team already stands there the two swap, provided the mover
 * may move that team too (a gym cannot shift another gym's team) and that
 * team is not itself running manually: a protected slot is never moved as a
 * side effect of somebody else's move (while Auto Assign is on).
 */
export async function setTeamStation(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED" };
  if (user.viewAs || !canPlaceTeams(user)) return { ok: false, error: "FORBIDDEN" };

  const parsed = stationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const found = await prisma.team.findFirst({ where: { id: parsed.data.teamId, archivedAt: null, ...teamScope(user) }, select: { seriesId: true } });
  if (!found) return { ok: false, error: "NOT_FOUND" };
  let label = "";
  try {
    label = await scheduleTransaction(found.seriesId, async tx => {
      const team = await tx.team.findFirst({ where: { id: parsed.data.teamId, archivedAt: null, ...teamScope(user) }, include: { waveRef: true } });
      if (!team?.waveId || !team.waveRef) throw new ScheduleError("NOT_FOUND");
      if (team.waitlistedAt || team.waveRef.status !== "pending") throw new ScheduleError("WAVE_STARTED");
      if (parsed.data.station > team.waveRef.capacity) throw new ScheduleError("BEYOND_CAPACITY");
      if (team.station === parsed.data.station) return "";
      if (await tx.zoneScore.count({ where: { status: "submitted", score: { teamId: team.id } } })) throw new ScheduleError("TEAM_ALREADY_SCORED");
      const occupant = await tx.team.findFirst({ where: { waveId: team.waveId, station: parsed.data.station }, select: { id: true, slotManualAt: true } });
      if (occupant && !await tx.team.count({ where: { id: occupant.id, ...teamScope(user) } })) throw new ScheduleError("STATION_TAKEN");
      // While Auto Assign is off nothing is protected from it: the two simply swap.
      if (occupant?.slotManualAt && await autoAssignOn(tx, found.seriesId)) throw new ScheduleError("STATION_PROTECTED");
      if (occupant) await tx.team.update({ where: { id: occupant.id }, data: { station: null } });
      await tx.team.update({ where: { id: team.id }, data: { station: parsed.data.station, slotManualAt: new Date() } });
      if (occupant) await tx.team.update({ where: { id: occupant.id }, data: { station: team.station } });
      return `${team.number} ${team.name}|wave ${team.waveRef.number}: station ${team.station ?? "—"} → ${parsed.data.station} · running manually${occupant ? " · swapped with the team that stood there" : ""}`;
    });
  } catch (error) { return scheduleError(error); }
  if (label) {
    const [targetLabel, detail] = label.split("|");
    await recordAudit({ actorId: user.id, action: AUDIT.teamSlotMoved, targetType: "team", targetId: parsed.data.teamId, targetLabel, detail });
    revalidateCompetitionViews();
  }
  return { ok: true };
}

const autoAssignSchema = z.object({
  seriesId: z.string().min(1),
  // One team per station: never more than nine.
  perWave: z.coerce.number().int().min(1).max(MAX_STATIONS),
});

/**
 * AUTO ASSIGN, by category (category-schedule.ts).
 *
 * Every team not running manually is dealt into waves of its OWN category's
 * block — Rookie, Open, Pro, then team number — from the block's configured
 * start, one spacing apart. Teams running manually stay in exactly their
 * slot, and their stations count as taken first.
 *
 * All or nothing: the whole plan is worked out and checked first; a single
 * conflict — a block that overruns the next one's start, a protected slot the
 * schedule no longer fits — and nothing is written, and the conflicts say
 * what is needed against what there is. Runs under the competition lock, so
 * a manual move made at the same moment is either seen (and kept) or waits.
 */
export async function autoAssignWaves(input: unknown): Promise<ActionResult> {
  const user = await requireAccess("waves.edit");
  // Rebuilds every gym's placements: a floor account's job, never a gym's.
  if (user.viewAs || !canBuildSchedule(user)) return { ok: false, error: "FORBIDDEN" };
  const parsed = autoAssignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId, perWave } = parsed.data;
  let outcome;
  try {
    outcome = await scheduleTransaction(seriesId, async (tx) => {
      const series = await tx.series.findUnique({ where: { id: seriesId } });
      if (!series || series.archivedAt) throw new ScheduleError("NOT_FOUND");
      if (series.status !== "scheduled" || await tx.wave.count({ where: { seriesId, status: { not: "pending" } } })) {
        throw new ScheduleError("WAVE_STARTED");
      }
      // A recorded result is history: nobody is reseated over it.
      if (await tx.zoneScore.count({ where: { status: "submitted", score: { team: { seriesId } } } })) throw new ScheduleError("RESULTS_RECORDED");
      const context = await loadScheduleContext(tx, seriesId, { capacity: perWave });
      // Switched off in Settings → Category schedule: the running order is built by hand.
      if (!context.autoAssign) throw new ScheduleError("AUTO_ASSIGN_OFF");
      if (!isScheduled(context.blocks)) throw new ScheduleError("CATEGORY_SCHEDULE_MISSING");
      const plan = planFor(context);
      if (plan.conflicts.length) throw new ScheduleConflictError("SCHEDULE_CONFLICT", plan.conflicts);
      await tx.series.update({ where: { id: seriesId }, data: { waveCapacity: perWave } });
      const written = await applyPlan(tx, context, plan);
      return { plan, written, name: series.name };
    });
  } catch (error) {
    if (error instanceof ScheduleConflictError) return { ok: false, error: error.code, conflicts: error.conflicts };
    return scheduleError(error);
  }
  const { plan, written } = outcome;
  const perBlock = plan.blocks.map((block) => `${block.category} ${block.waves} wave(s) from ${plan.waves.find((wave) => wave.block === block.category)?.startTime ?? "—"}`).join(", ");
  const held = plan.waves.flatMap((wave) => wave.seats).filter((seat) => seat.protected).length;
  await recordAudit({ actorId: user.id, action: AUDIT.wavesAssigned, targetType: "event", targetId: seriesId, targetLabel: outcome.name,
    detail: `by category schedule: ${plan.waves.flatMap((wave) => wave.seats).length} teams in ${plan.waves.length} waves (${perBlock}); ${held} running manually kept in place; capacity=${perWave}; ${written.renumbered} kept wave(s) renumbered` });
  revalidateCompetitionViews();
  return { ok: true };
}
