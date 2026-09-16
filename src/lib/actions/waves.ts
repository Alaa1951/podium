"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { deletionGuard } from "@/lib/series-guard";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

// ── Waves ────────────────────────────────────────────────────────────────────
// A wave is a row, not a number on the event. That is what lets an operator
// press START on wave 3 while wave 2 is still on the floor, and what lets one
// wave be twenty minutes of nine teams and the next fifteen of five.

const waveSchema = z.object({
  waveId: z.string().min(1),
  action: z.enum(["start", "finish", "reset", "extend"]),
  /** Minutes to add, for "extend" only. */
  minutes: z.coerce.number().int().min(1).max(60).optional(),
});

/**
 * The wave clock. It lives on the wave row rather than in a browser, so every
 * screen in the venue — the board on the wall, the operator's laptop — reads
 * the same countdown, and several waves can be counting down at once.
 */
export async function controlWave(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = waveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const wave = await prisma.wave.findUnique({
    where: { id: parsed.data.waveId },
    include: { _count: { select: { teams: true } } },
  });
  if (!wave) return { ok: false, error: "NOT_FOUND" };

  const now = Date.now();
  const fullMs = wave.durationMinutes * 60_000;
  let data: Record<string, unknown>;

  switch (parsed.data.action) {
    case "start": {
      // Starting an empty wave would put a clock on an empty floor.
      if (wave._count.teams === 0) return { ok: false, error: "NO_TEAMS" };
      if (wave.status === "running") return { ok: false, error: "ALREADY_RUNNING" };
      data = {
        status: "running",
        startedAt: new Date(now),
        endsAt: new Date(now + fullMs),
      };
      break;
    }
    case "finish": {
      // A wave ends when the floor says it ends, not when the clock runs out —
      // the clock is the plan, the operator is the authority.
      data = { status: "complete", endsAt: new Date(now) };
      break;
    }
    case "reset": {
      // Back to not-yet-run. Scores already entered are untouched: this is a
      // correction to the schedule, never to the results.
      data = { status: "pending", startedAt: null, endsAt: null };
      break;
    }
    case "extend": {
      if (wave.status !== "running") return { ok: false, error: "NOT_RUNNING" };
      const addMs = (parsed.data.minutes ?? 1) * 60_000;
      const base = Math.max(now, wave.endsAt?.getTime() ?? now);
      data = { endsAt: new Date(base + addMs) };
      break;
    }
  }

  await prisma.wave.update({ where: { id: wave.id }, data });

  // ── Stopping a wave records what the clock owed its finishers ────────────
  // Ending a wave before 00:00 freezes the remaining time at this instant, and
  // every team that already submitted a score but has no finisher time on
  // record receives that remaining time in Zone 4 — the seconds between the
  // wave's allotted length and where they actually got to. Teams the judges
  // captured individually keep their own times; the clock is only the
  // fallback for the ones nobody timed.
  let backfilled = 0;
  if (
    parsed.data.action === "finish" &&
    wave.status === "running" &&
    wave.startedAt
  ) {
    const elapsedMs = Math.max(0, now - wave.startedAt.getTime());
    const remainingMs = Math.max(0, fullMs - elapsedMs);
    const minutes = Math.floor(remainingMs / 60_000);
    const seconds = Math.floor((remainingMs % 60_000) / 1000);

    const clockInputs = await prisma.zoneInput.findMany({
      where: { zone: { seriesId: wave.seriesId }, inputMode: { in: ["minutes", "seconds"] } },
      select: { id: true, inputMode: true },
    });
    const minutesId = clockInputs.find((one) => one.inputMode === "minutes")?.id;
    const secondsId = clockInputs.find((one) => one.inputMode === "seconds")?.id;

    if (minutesId && secondsId) {
      const scored = await prisma.team.findMany({
        where: { waveId: wave.id, score: { status: "submitted" } },
        select: {
          score: { select: { id: true, entries: { select: { inputId: true, value: true } } } },
        },
      });
      for (const team of scored) {
        const score = team.score;
        if (!score) continue;
        // The judges' own captures are never overwritten by the clock.
        if (
          score.entries.some(
            (entry) => (entry.inputId === minutesId || entry.inputId === secondsId) && entry.value !== null
          )
        ) {
          continue;
        }
        await prisma.zoneEntry.upsert({
          where: { scoreId_inputId: { scoreId: score.id, inputId: minutesId } },
          create: { scoreId: score.id, inputId: minutesId, value: minutes },
          update: { value: minutes },
        });
        await prisma.zoneEntry.upsert({
          where: { scoreId_inputId: { scoreId: score.id, inputId: secondsId } },
          create: { scoreId: score.id, inputId: secondsId, value: seconds },
          update: { value: seconds },
        });
        backfilled += 1;
      }
    }
  }

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.waveControlled,
    targetType: "event",
    targetId: wave.seriesId,
    targetLabel: `Wave ${wave.number}`,
    detail:
      `wave=${wave.number} action=${parsed.data.action}` +
      (backfilled > 0 ? ` finisher_backfilled=${backfilled}` : ""),
  });

  revalidatePath("/series", "layout");
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
  await requireRole("admin");

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

  revalidatePath("/series", "layout");
  return { ok: true };
}

/**
 * Remove a wave. Its teams are not deleted — they go back to unassigned, which
 * is the honest state for a team whose wave no longer exists.
 */
export async function deleteWave(input: unknown): Promise<ActionResult> {
  await requireRole("admin");

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
    prisma.team.updateMany({ where: { waveId: wave.id }, data: { waveId: null } }),
    prisma.wave.delete({ where: { id: wave.id } }),
  ]);

  revalidatePath("/series", "layout");
  return { ok: true };
}

const scheduleSchema = z.object({
  seriesId: z.string().min(1),
  firstWaveTime: z.string().regex(/^\d{2}:\d{2}$/),
  waveCapacity: z.coerce.number().int().min(1).max(40),
});

export async function updateSchedule(input: unknown): Promise<ActionResult> {
  await requireRole("admin");

  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  await prisma.series.update({
    where: { id: parsed.data.seriesId },
    data: {
      firstWaveTime: parsed.data.firstWaveTime,
      waveCapacity: parsed.data.waveCapacity,
    },
  });

  revalidatePath("/series", "layout");
  return { ok: true };
}
