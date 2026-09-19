"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { MAX_STATIONS, zoneOneFreeAt } from "@/lib/floor";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { requireAccess } from "@/lib/session";
import { deletionGuard } from "@/lib/series-guard";
import { fillFinisherTimes, floorTimingFor, waveLengthFor } from "@/lib/wave-clock";

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

  const wave = await prisma.wave.findUnique({
    where: { id: parsed.data.waveId },
    include: {
      series: { select: { status: true } },
      teams: { where: { archivedAt: null }, select: { station: true } },
    },
  });
  if (!wave) return { ok: false, error: "NOT_FOUND" };

  const now = new Date();
  let detail = "";

  switch (parsed.data.action) {
    case "start": {
      if (wave.series.status !== "live") return { ok: false, error: "SERIES_NOT_LIVE" };
      if (wave.status !== "pending") return { ok: false, error: "ALREADY_STARTED" };
      // Starting an empty wave would put a clock on an empty floor.
      if (wave.teams.length === 0) return { ok: false, error: "NO_TEAMS" };
      if (wave.teams.length > MAX_STATIONS || wave.teams.some((team) => team.station === null)) {
        return { ok: false, error: "STATIONS_MISSING" };
      }

      const timing = await floorTimingFor(wave.seriesId);
      if (timing.zoneCount === 0) return { ok: false, error: "NO_ZONES" };

      // Zone 1 must be free: waves stay one zone apart, so two never meet.
      const running = await prisma.wave.findMany({
        where: { seriesId: wave.seriesId, status: "running", NOT: { id: wave.id } },
        select: { startedAt: true },
      });
      const freeAt = zoneOneFreeAt(running, timing, now);
      if (freeAt) return { ok: false, error: "ZONE_OCCUPIED", freeInMs: freeAt.getTime() - now.getTime() };

      const minutes = waveLengthFor(timing);
      const started = await prisma.wave.updateMany({
        where: { id: wave.id, status: "pending" },
        data: {
          status: "running",
          durationMinutes: minutes,
          startedAt: now,
          endsAt: new Date(now.getTime() + minutes * 60_000),
        },
      });
      if (started.count === 0) return { ok: false, error: "ALREADY_STARTED" };
      detail = `${minutes} min, ${timing.zoneCount} zones`;
      break;
    }
    case "finish": {
      if (wave.status !== "running") return { ok: false, error: "NOT_RUNNING" };
      // "End now" is for emergencies. Every team that competed without being
      // stopped keeps the time the wave had left at this instant.
      const remainingMs = Math.max(0, (wave.endsAt?.getTime() ?? now.getTime()) - now.getTime());
      const filled = await prisma.$transaction(async (tx) => {
        const done = await tx.wave.updateMany({
          where: { id: wave.id, status: "running" },
          data: { status: "complete", endsAt: now },
        });
        return done.count === 1 ? fillFinisherTimes(tx, wave, remainingMs) : 0;
      });
      detail = `ended early with ${Math.round(remainingMs / 1000)}s left${filled ? `; finisher time recorded for ${filled}` : ""}`;
      break;
    }
    case "reset": {
      // Back to not-yet-run. Scores already entered are untouched: this is a
      // correction to the schedule, never to the results.
      await prisma.wave.update({
        where: { id: wave.id },
        data: { status: "pending", startedAt: null, endsAt: null },
      });
      break;
    }
  }

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.waveControlled,
    targetType: "event",
    targetId: wave.seriesId,
    targetLabel: `Wave ${wave.number}`,
    detail: `wave=${wave.number} action=${parsed.data.action}${detail ? ` ${detail}` : ""}`,
  });

  revalidateCompetitionViews();
  return { ok: true };
}

const waveSaveSchema = z.object({
  seriesId: z.string().min(1),
  waveId: z.string().min(1).optional(),
  number: z.coerce.number().int().min(1).max(99),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
});

/**
 * Create or edit a wave. A wave owns two things — its number in the running
 * order and its estimated start. Its length and capacity belong to the
 * competition's settings, and are stamped onto the wave from there, so one
 * change in Settings reaches every wave at once.
 */
export async function saveWave(input: unknown): Promise<ActionResult> {
  await requireAccess("waves.edit");

  const parsed = waveSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId, waveId, number, startTime } = parsed.data;

  const clash = await prisma.wave.findFirst({
    where: { seriesId, number, ...(waveId ? { NOT: { id: waveId } } : {}) },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "WAVE_NUMBER_TAKEN" };

  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    select: { waveMinutes: true, waveCapacity: true },
  });
  if (!series) return { ok: false, error: "NOT_FOUND" };

  const fields = {
    number,
    startTime,
    durationMinutes: series.waveMinutes,
    capacity: series.waveCapacity,
  };

  if (waveId) {
    await prisma.wave.update({ where: { id: waveId }, data: fields });
  } else {
    await prisma.wave.create({ data: { seriesId, ...fields } });
  }

  revalidateCompetitionViews();
  return { ok: true };
}

/**
 * Remove a wave. Its teams are not deleted — they go back to unassigned, which
 * is the honest state for a team whose wave no longer exists.
 */
export async function deleteWave(input: unknown): Promise<ActionResult> {
  await requireAccess("waves.edit");

  const parsed = z.object({ waveId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const wave = await prisma.wave.findUnique({
    where: { id: parsed.data.waveId },
    select: { id: true, seriesId: true, status: true, series: { select: { status: true } } },
  });
  if (!wave) return { ok: false, error: "NOT_FOUND" };
  if (wave.status === "running") return { ok: false, error: "WAVE_RUNNING" };

  // A live event is locked and a finished one is the record: its waves can no
  // more be removed than its results can.
  const phase = deletionGuard(wave.series.status);
  if (!phase.allowed) return { ok: false, error: phase.reason };

  await prisma.$transaction([
    prisma.team.updateMany({ where: { waveId: wave.id }, data: { waveId: null, station: null } }),
    prisma.wave.delete({ where: { id: wave.id } }),
  ]);

  revalidateCompetitionViews();
  return { ok: true };
}

const scheduleSchema = z.object({
  seriesId: z.string().min(1),
  firstWaveTime: z.string().regex(/^\d{2}:\d{2}$/),
  // One team per station: never more than nine.
  waveCapacity: z.coerce.number().int().min(1).max(MAX_STATIONS),
});

export async function updateSchedule(input: unknown): Promise<ActionResult> {
  await requireAccess("waves.edit");

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
