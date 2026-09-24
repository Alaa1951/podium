"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { MAX_STATIONS, zoneOneFreeAt } from "@/lib/floor";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { requireAccess } from "@/lib/session";
import { ScheduleError, scheduledTime, scheduleError, TIME_PATTERN } from "@/lib/wave-schedule";
import { scheduleTransaction, waveRowFor } from "@/lib/wave-schedule-db";
import { deletionGuard } from "@/lib/series-guard";
import type { Prisma } from "@/generated/prisma/client";
import { fillFinisherTimes, waveLengthFor } from "@/lib/wave-clock";

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; freeInMs?: number };

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
 * The supervisor's buttons. Gated by `waveControl.control` — the supervisor
 * permission — and re-checked against the database on every press.
 */
export async function controlWave(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("waveControl.control");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = waveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const found = await prisma.wave.findUnique({ where: { id: parsed.data.waveId }, select: { seriesId: true } });
  if (!found) return { ok: false, error: "NOT_FOUND" };
  const result = await scheduleTransaction(found.seriesId, tx => controlLocked(tx, parsed.data));
  if (!result.ok) return result;
  await recordAudit({ actorId: actor.id, action: AUDIT.waveControlled, targetType: "event", targetId: found.seriesId,
    detail: "wave=" + parsed.data.waveId + " action=" + parsed.data.action });
  revalidateCompetitionViews();
  return { ok: true };
}

async function controlLocked(tx: Prisma.TransactionClient, input: z.infer<typeof waveSchema>): Promise<ActionResult> {
  const wave = await tx.wave.findUnique({ where: { id: input.waveId }, include: {
    series: true, teams: { where: { archivedAt: null, waitlistedAt: null }, select: { station: true } },
  } });
  if (!wave || wave.series.archivedAt) return { ok: false, error: "NOT_FOUND" };
  const now = new Date();
  switch (input.action) {
    case "start": {
      if (wave.series.status !== "live") return { ok: false, error: "SERIES_NOT_LIVE" };
      if (wave.status !== "pending") return { ok: false, error: "ALREADY_STARTED" };
      if (!wave.teams.length) return { ok: false, error: "NO_TEAMS" };
      if (wave.teams.length > wave.capacity || wave.teams.length > MAX_STATIONS || wave.teams.some(team => team.station === null)) return { ok: false, error: "STATIONS_MISSING" };
      const timing = { workMinutes: wave.series.zoneWorkMinutes, breakMinutes: wave.series.zoneBreakMinutes,
        zoneCount: await tx.zone.count({ where: { seriesId: wave.seriesId } }) };
      if (!timing.zoneCount) return { ok: false, error: "NO_ZONES" };
      const running = await tx.wave.findMany({ where: { seriesId: wave.seriesId, status: "running", NOT: { id: wave.id } }, select: { startedAt: true } });
      const freeAt = zoneOneFreeAt(running, timing, now);
      if (freeAt) return { ok: false, error: "ZONE_OCCUPIED", freeInMs: freeAt.getTime() - now.getTime() };
      const minutes = waveLengthFor(timing);
      await tx.wave.update({ where: { id: wave.id }, data: { status: "running", durationMinutes: minutes, startedAt: now, endsAt: new Date(now.getTime() + minutes * 60_000) } });
      break;
    }
    case "finish": {
      if (wave.status !== "running") return { ok: false, error: "NOT_RUNNING" };
      const remaining = Math.max(0, (wave.endsAt?.getTime() ?? now.getTime()) - now.getTime());
      await tx.wave.update({ where: { id: wave.id }, data: { status: "complete", endsAt: now } });
      await fillFinisherTimes(tx, wave, remaining);
      break;
    }
    case "reset":
      await tx.wave.update({ where: { id: wave.id }, data: { status: "pending", startedAt: null, endsAt: null } });
      break;
  }
  return { ok: true };
}

const waveSaveSchema = z.object({
  seriesId: z.string().min(1),
  waveId: z.string().min(1).optional(),
  number: z.coerce.number().int().min(1).max(99),
  startTime: z.string().regex(TIME_PATTERN).optional(),
});

/**
 * Create or edit a wave. A wave owns two things — its number in the running
 * order and its estimated start. Its length and capacity belong to the
 * competition's settings, and are stamped onto the wave from there, so one
 * change in Settings reaches every wave at once.
 */
export async function saveWave(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("waves.edit");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = waveSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId, waveId, number, startTime } = parsed.data;
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
        await tx.wave.update({ where: { id: wave.id }, data: { number, startTime } });
        await tx.team.updateMany({ where: { waveId: wave.id }, data: { wave: number } });
      } else {
        const wave = await waveRowFor(tx, seriesId, number);
        if (startTime) await tx.wave.update({ where: { id: wave.id }, data: { startTime } });
      }
    });
  } catch (error) { return scheduleError(error); }
  await recordAudit({ actorId: actor.id, action: AUDIT.waveScheduleChanged, targetType: "event", targetId: seriesId,
    detail: "wave=" + number + (startTime ? " start=" + startTime : " created") });
  revalidateCompetitionViews();
  return { ok: true };
}

export async function arrangeWaveTimes(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("waves.edit");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = z.object({ seriesId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId } = parsed.data;
  try {
    await scheduleTransaction(seriesId, async (tx) => {
      const series = await tx.series.findUnique({ where: { id: seriesId } });
      if (!series || series.archivedAt) throw new ScheduleError("NOT_FOUND");
      const waves = await tx.wave.findMany({ where: { seriesId }, orderBy: { number: "asc" } });
      if (series.status !== "scheduled" || waves.some(w => w.status !== "pending")) throw new ScheduleError("WAVE_STARTED");
      const times = waves.map((wave, index) => ({ id: wave.id, startTime: scheduledTime(series.firstWaveTime, series.waveIntervalMinutes, index) }));
      for (const time of times) await tx.wave.update({ where: { id: time.id }, data: { startTime: time.startTime } });
    });
  } catch (error) { return scheduleError(error); }
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
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
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
      await tx.team.updateMany({ where: { waveId: wave.id }, data: { waveId: null, station: null } });
      await tx.wave.delete({ where: { id: wave.id } });
    });
  } catch (error) { return scheduleError(error); }
  revalidateCompetitionViews();
  return { ok: true };
}

const scheduleSchema = z.object({
  seriesId: z.string().min(1),
  firstWaveTime: z.string().regex(TIME_PATTERN),
  // One team per station: never more than nine.
  waveCapacity: z.coerce.number().int().min(1).max(MAX_STATIONS),
});

export async function updateSchedule(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("waves.edit");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  await prisma.series.update({
    where: { id: parsed.data.seriesId },
    data: {
      firstWaveTime: parsed.data.firstWaveTime,
      waveCapacity: parsed.data.waveCapacity,
    },
  });

  revalidateCompetitionViews();
  return { ok: true };
}
