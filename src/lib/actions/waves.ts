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

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.waveControlled,
    targetType: "event",
    targetId: wave.seriesId,
    targetLabel: `Wave ${wave.number}`,
    detail: `wave=${wave.number} action=${parsed.data.action}`,
  });

  revalidatePath("/series", "layout");
  return { ok: true };
}

const waveSaveSchema = z.object({
  seriesId: z.string().min(1),
  waveId: z.string().min(1).optional(),
  number: z.coerce.number().int().min(1).max(99),
  startTime: z.string().regex(/^d{2}:d{2}$/),
  durationMinutes: z.coerce.number().int().min(1).max(180),
  capacity: z.coerce.number().int().min(1).max(99),
});

/**
 * Create or edit a wave. Every number here is a setting rather than a constant:
 * nine teams and twenty minutes are only what a new wave starts out as.
 */
export async function saveWave(input: unknown): Promise<ActionResult> {
  await requireRole("admin");

  const parsed = waveSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId, waveId, ...fields } = parsed.data;

  const clash = await prisma.wave.findFirst({
    where: { seriesId, number: fields.number, ...(waveId ? { NOT: { id: waveId } } : {}) },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "WAVE_NUMBER_TAKEN" };

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
