"use server";

import { incompleteTeamPolicyEnabled } from "@/lib/ownership";
import { isCompeting } from "@/lib/team-status";
import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { notifyBoardChanged } from "@/lib/board-events";
import { finisherRemainingMs, MAX_STATIONS, zoneOneFreeAt } from "@/lib/floor";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { can, canBuildSchedule, canControlWave, waveButtons } from "@/lib/access";
import { formatQatarDayKey } from "@/lib/qatar-time";
import { getCurrentUser, requireAccess } from "@/lib/session";
import { ScheduleError, scheduledTime, scheduleError, TIME_PATTERN } from "@/lib/wave-schedule";
import { scheduleTransaction, waveRowFor } from "@/lib/wave-schedule-db";
import { deletionGuard } from "@/lib/series-guard";
import type { Prisma } from "@/generated/prisma/client";
import { fillFinisherTimes, waveLengthFor } from "@/lib/wave-clock";
import { isScheduled, loadBlocks } from "@/lib/category-schedule-db";
import type { TeamGaps } from "@/lib/readiness";
import { waveStartBlockers } from "@/lib/wave-start-check";
import { isEventReadinessOverridden } from "@/lib/event-readiness-override";
import { protectedIn, ProtectedWaveError } from "@/lib/wave-protection";

const protectedResult = (error: unknown): ActionResult | null =>
  error instanceof ProtectedWaveError ? { ok: false, error: error.message, teams: error.teams } : null;

export type ActionResult =
  | { ok: true; message?: string }
  /** NOT_READY: `blockers` lists what is missing, by team and athlete (readiness.ts). */
  | { ok: false; error: string; freeInMs?: number; teams?: number[]; blockers?: TeamGaps[] };

// ── Waves ────────────────────────────────────────────────────────────────────
// A wave is a row, not a number on the event. The supervisor presses START
// once; the wave then moves through every zone by itself (src/lib/floor.ts),
// and several waves can be on the floor at once, one zone apart.

const waveSchema = z.object({
  waveId: z.string().min(1),
  /** start · finish ("End now", for emergencies) · reset (back to not run). */
  action: z.enum(["start", "finish", "reset"]),
});

/**
 * The wave buttons. The supervisor (`waveControl.control`) presses all three,
 * or someone given one button on its own (waveControl.start / .end / .reset);
 * a zone leader of the wave's competition presses Start (canControlWave,
 * access.ts). Re-checked against the database on every press.
 */
export async function controlWave(input: unknown): Promise<ActionResult> {
  // Not requireAccess: an action answers a refusal, it never redirects the
  // fetch — and a zone leader has no waveControl key to be let in by.
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "UNAUTHENTICATED" };
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = waveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const found = await prisma.wave.findUnique({ where: { id: parsed.data.waveId }, select: { seriesId: true } });
  if (!found) return { ok: false, error: "NOT_FOUND" };
  // A post is worked through the Judge sheet: a leader whose Judge role was
  // taken away keeps the ZoneStaff row, but not the powers that come with it.
  const leadsAZone =
    parsed.data.action === "start" &&
    can(actor, "judgeSheet.view") &&
    (await prisma.zoneStaff.count({ where: { seriesId: found.seriesId, userId: actor.id, position: "leader" } })) > 0;
  if (!canControlWave(actor, parsed.data.action, leadsAZone)) return { ok: false, error: "FORBIDDEN" };
  // Fresh reads: the readiness check must see what it waited for (wave-schedule-db.ts).
  const result = await scheduleTransaction(found.seriesId, tx => controlLocked(tx, parsed.data, actor.role === "admin"), { freshReads: true });
  if (!result.ok) return result;
  // Start, End and Reset all move the floor: push every board screen now, so
  // rigs and walls show the new wave within a second instead of on their next
  // ten-second poll — a judge must not meet a team their screens never named.
  notifyBoardChanged(found.seriesId);
  await recordAudit({ actorId: actor.id, action: AUDIT.waveControlled, targetType: "event", targetId: found.seriesId,
    detail: "wave=" + parsed.data.waveId + " action=" + parsed.data.action + (result.message ? " " + result.message : "") });
  revalidateCompetitionViews();
  return { ok: true };
}

async function controlLocked(tx: Prisma.TransactionClient, input: z.infer<typeof waveSchema>, fullAccess: boolean): Promise<ActionResult> {
  const wave = await tx.wave.findUnique({ where: { id: input.waveId }, include: {
    series: true, teams: { where: { archivedAt: null, waitlistedAt: null }, select: { station: true, number: true, paymentStatus: true, waitlistedAt: true, _count: { select: { competitors: true } } } },
  } });
  if (!wave || wave.series.archivedAt) return { ok: false, error: "NOT_FOUND" };
  const now = new Date();
  switch (input.action) {
    case "start": {
      if (wave.series.status !== "live") return { ok: false, error: "SERIES_NOT_LIVE" };
      if (wave.status !== "pending") return { ok: false, error: "ALREADY_STARTED" };
      if (!wave.teams.length) return { ok: false, error: "NO_TEAMS" };
      if (wave.teams.length > wave.capacity || wave.teams.length > MAX_STATIONS || wave.teams.some(team => team.station === null)) return { ok: false, error: "STATIONS_MISSING" };
      // A paid team of one does not start (decision D3b, once switched on):
      // the floor would have a station with half a pair on it.
      if (incompleteTeamPolicyEnabled()) {
        const incomplete = wave.teams.filter(team => isCompeting(team) && team._count.competitors < 2).map(team => team.number);
        if (incomplete.length) return { ok: false, error: "INCOMPLETE_TEAM", teams: incomplete };
      }
      // The scoped emergency override waives operational readiness only.
      // Team/athlete locks and structural start checks remain in force.
      const readinessOverridden = isEventReadinessOverridden(wave.series);
      const blockers = await waveStartBlockers(tx, wave.id, wave.seriesId, readinessOverridden);
      if (blockers.length) return { ok: false, error: "NOT_READY", blockers };
      const timing = { workMinutes: wave.series.zoneWorkMinutes, breakMinutes: wave.series.zoneBreakMinutes,
        zoneCount: await tx.zone.count({ where: { seriesId: wave.seriesId } }) };
      if (!timing.zoneCount) return { ok: false, error: "NO_ZONES" };
      const running = await tx.wave.findMany({ where: { seriesId: wave.seriesId, status: "running", NOT: { id: wave.id } }, select: { startedAt: true } });
      const freeAt = zoneOneFreeAt(running, timing, now);
      if (freeAt) return { ok: false, error: "ZONE_OCCUPIED", freeInMs: freeAt.getTime() - now.getTime() };
      const minutes = waveLengthFor(timing);
      await tx.wave.update({ where: { id: wave.id }, data: { status: "running", durationMinutes: minutes, startedAt: now, endsAt: new Date(now.getTime() + minutes * 60_000) } });
      return { ok: true, message: `(wave ${wave.number}, ${wave.teams.length} teams, ${readinessOverridden ? "emergency readiness override: waiver, entrance and warm-up requirements waived" : "every athlete signed, checked in and ready"})` };
    }
    case "finish": {
      // A finished competition's floor is history: its results stand on it.
      if (wave.series.status === "final") return { ok: false, error: "SERIES_FINISHED" };
      if (wave.status !== "running") return { ok: false, error: "NOT_RUNNING" };
      // Only what the LAST zone had left counts — ending the wave before its
      // finisher began records 0:00, never the rest of the whole wave clock.
      const waveRemaining = (wave.endsAt?.getTime() ?? now.getTime()) - now.getTime();
      const remaining = finisherRemainingMs(waveRemaining, wave.series.zoneWorkMinutes) ?? 0;
      await tx.wave.update({ where: { id: wave.id }, data: { status: "complete", endsAt: now } });
      await fillFinisherTimes(tx, wave, remaining);
      break;
    }
    case "reset":
      if (wave.series.status === "final") return { ok: false, error: "SERIES_FINISHED" };
      // Reset puts the wave back to "not started": its clock is gone, judges'
      // open sheets for it disappear, and it can be run again over what was
      // recorded. Once any zone of it has been SUBMITTED that rewrites
      // results, which is BFT MENA Full access's call alone.
      if (!fullAccess) {
        const submitted = await tx.zoneScore.count({
          where: { status: "submitted", score: { team: { waveId: wave.id } } },
        });
        if (submitted > 0) return { ok: false, error: "WAVE_HAS_SCORES" };
      }
      await tx.wave.update({ where: { id: wave.id }, data: { status: "pending", startedAt: null, endsAt: null } });
      break;
  }
  return { ok: true };
}

/**
 * START THE DAY — the one status change the floor makes itself. No wave can
 * start and no judge can score until the competition is Running, and the
 * people running the floor are not always the ones who hold Settings
 * (settings.edit is BFT MENA's). So the supervisor (waveControl.control, or
 * waveControl.startDay alone) sets a SCHEDULED competition to Running from
 * Wave control. Nothing else: back to scheduled, or finished, stays in
 * Settings.
 *
 * Only ON the competition's day for anyone outside BFT MENA. Roles are not
 * tied to one competition yet, so an organiser holds this button for every
 * competition — and starting next month's by mistake opens its judge sheets
 * and its board today.
 */
export async function startCompetitionDay(input: unknown): Promise<ActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "UNAUTHENTICATED" };
  if (actor.viewAs || !waveButtons(actor).startDay) return { ok: false, error: "FORBIDDEN" };
  const parsed = z.object({ seriesId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const series = await prisma.series.findUnique({
    where: { id: parsed.data.seriesId },
    select: { id: true, status: true, archivedAt: true, competitionDate: true },
  });
  if (!series || series.archivedAt) return { ok: false, error: "NOT_FOUND" };
  if (series.status !== "scheduled") return { ok: false, error: "NOT_SCHEDULED" };
  const bft = actor.role === "admin" || actor.role === "staff";
  if (!bft && formatQatarDayKey(series.competitionDate) !== formatQatarDayKey(new Date())) {
    return { ok: false, error: "NOT_TODAY" };
  }
  // Conditional, so two supervisors pressing at once start it only once.
  const started = await prisma.series.updateMany({
    where: { id: series.id, status: "scheduled" },
    data: { status: "live" },
  });
  if (started.count === 0) return { ok: false, error: "NOT_SCHEDULED" };
  // The day opening changes every sheet and board: push, don't let them poll.
  notifyBoardChanged(series.id);

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.seriesStatusChanged,
    targetType: "event",
    targetId: series.id,
    detail: "status=live (started from Wave control)",
  });
  revalidateCompetitionViews();
  return { ok: true };
}

const waveSaveSchema = z.object({
  seriesId: z.string().min(1),
  waveId: z.string().min(1).optional(),
  number: z.coerce.number().int().min(1).max(99),
  startTime: z.string().regex(TIME_PATTERN).optional(),
  /** The person confirmed changing a wave that holds teams running manually. */
  confirmProtected: z.coerce.boolean().default(false),
});

/**
 * Create or edit a wave. A wave owns two things — its number in the running
 * order and its estimated start. Its length and capacity belong to the
 * competition's settings, and are stamped onto the wave from there, so one
 * change in Settings reaches every wave at once.
 */
export async function saveWave(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("waves.edit");
  if (actor.viewAs || !canBuildSchedule(actor)) return { ok: false, error: "FORBIDDEN" };
  const parsed = waveSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId, waveId, number, startTime, confirmProtected } = parsed.data;
  try {
    await scheduleTransaction(seriesId, async (tx) => {
      const series = await tx.series.findUnique({ where: { id: seriesId } });
      if (!series || series.archivedAt) throw new ScheduleError("NOT_FOUND");
      if (series.status === "final") throw new ScheduleError("SERIES_FINISHED");
      const clash = await tx.wave.findFirst({ where: { seriesId, number, ...(waveId ? { NOT: { id: waveId } } : {}) } });
      if (clash) throw new ScheduleError("WAVE_NUMBER_TAKEN");
      if (waveId) {
        const wave = await tx.wave.findFirst({ where: { id: waveId, seriesId } });
        if (!wave) throw new ScheduleError("NOT_FOUND");
        if (wave.status !== "pending") throw new ScheduleError("WAVE_STARTED");
        if (!startTime) throw new ScheduleError("INVALID_INPUT");
        // A wave holding teams running manually moves them with it: only on
        // purpose — unless Auto Assign is off, when every slot is set by hand.
        if ((wave.number !== number || wave.startTime !== startTime) && !confirmProtected && series.autoAssignEnabled) {
          const held = await protectedIn(tx, [wave.id]);
          if (held.length) throw new ProtectedWaveError("PROTECTED_WAVE", held);
        }
        await tx.wave.update({ where: { id: wave.id }, data: { number, startTime } });
        await tx.team.updateMany({ where: { waveId: wave.id }, data: { wave: number } });
      } else {
        const wave = await waveRowFor(tx, seriesId, number);
        if (startTime) await tx.wave.update({ where: { id: wave.id }, data: { startTime } });
      }
    });
  } catch (error) { return protectedResult(error) ?? scheduleError(error); }
  await recordAudit({ actorId: actor.id, action: AUDIT.waveScheduleChanged, targetType: "event", targetId: seriesId,
    detail: "wave=" + number + (startTime ? " start=" + startTime : " created") + (confirmProtected ? " (holds teams running manually — confirmed)" : "") });
  revalidateCompetitionViews();
  return { ok: true };
}

export async function arrangeWaveTimes(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("waves.edit");
  if (actor.viewAs || !canBuildSchedule(actor)) return { ok: false, error: "FORBIDDEN" };
  const parsed = z.object({ seriesId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId } = parsed.data;
  try {
    await scheduleTransaction(seriesId, async (tx) => {
      const series = await tx.series.findUnique({ where: { id: seriesId } });
      if (!series || series.archivedAt) throw new ScheduleError("NOT_FOUND");
      const waves = await tx.wave.findMany({ where: { seriesId }, orderBy: { number: "asc" } });
      if (series.status !== "scheduled" || waves.some(w => w.status !== "pending")) throw new ScheduleError("WAVE_STARTED");
      // With a category schedule, times come from each category's block: Auto
      // Assign lays them out. Switched off, the times are the staff's again.
      if (series.autoAssignEnabled) {
        if (isScheduled(await loadBlocks(tx, seriesId))) throw new ScheduleError("CATEGORY_SCHEDULE_ACTIVE");
        const held = await protectedIn(tx, waves.map(w => w.id));
        if (held.length) throw new ProtectedWaveError("PROTECTED_CONFLICT", held);
      }
      const times = waves.map((wave, index) => ({ id: wave.id, startTime: scheduledTime(series.firstWaveTime, series.waveIntervalMinutes, index) }));
      for (const time of times) await tx.wave.update({ where: { id: time.id }, data: { startTime: time.startTime } });
    });
  } catch (error) { return protectedResult(error) ?? scheduleError(error); }
  await recordAudit({ actorId: actor.id, action: AUDIT.waveScheduleChanged, targetType: "event", targetId: seriesId, detail: "arranged estimated starts" });
  revalidateCompetitionViews();
  return { ok: true };
}

/**
 * Remove a wave. Its teams are not deleted — they go back to unassigned, which
 * is the honest state for a team whose wave no longer exists.
 */
export async function deleteWave(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("waves.edit");
  if (actor.viewAs || !canBuildSchedule(actor)) return { ok: false, error: "FORBIDDEN" };
  const parsed = z.object({ waveId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const found = await prisma.wave.findUnique({ where: { id: parsed.data.waveId }, select: { seriesId: true } });
  if (!found) return { ok: false, error: "NOT_FOUND" };
  try {
    await scheduleTransaction(found.seriesId, async tx => {
      const wave = await tx.wave.findUnique({ where: { id: parsed.data.waveId }, include: { series: true } });
      if (!wave || wave.series.archivedAt) throw new ScheduleError("NOT_FOUND");
      if (wave.status !== "pending") throw new ScheduleError("WAVE_STARTED");
      const guard = deletionGuard(wave.series.status);
      if (!guard.allowed) throw new ScheduleError(guard.reason);
      // Removing a wave would take a protected team off the running order:
      // resolve it first — while Auto Assign is on to protect it.
      const held = wave.series.autoAssignEnabled ? await protectedIn(tx, [wave.id]) : [];
      if (held.length) throw new ProtectedWaveError("PROTECTED_CONFLICT", held);
      await tx.team.updateMany({ where: { waveId: wave.id }, data: { waveId: null, station: null } });
      await tx.wave.delete({ where: { id: wave.id } });
    });
  } catch (error) { return protectedResult(error) ?? scheduleError(error); }
  await recordAudit({ actorId: actor.id, action: AUDIT.waveScheduleChanged, targetType: "event", targetId: found.seriesId,
    detail: "wave=" + parsed.data.waveId + " deleted" });
  revalidateCompetitionViews();
  return { ok: true };
}
