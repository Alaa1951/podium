import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { remainingClock, waveLengthMinutes, type FloorTiming } from "@/lib/floor";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// The wave clock's writes — shared by the supervisor's buttons and the lazy
// sweep that ends a wave when its time is up.
// ─────────────────────────────────────────────────────────────────────────────

type Db = Prisma.TransactionClient | typeof prisma;

/** A competition's zone timing, read from its settings and its zones. */
export async function floorTimingFor(seriesId: string, db: Db = prisma): Promise<FloorTiming> {
  const [series, zoneCount] = await Promise.all([
    db.series.findUnique({
      where: { id: seriesId },
      select: { zoneWorkMinutes: true, zoneBreakMinutes: true },
    }),
    db.zone.count({ where: { seriesId } }),
  ]);
  return {
    workMinutes: series?.zoneWorkMinutes ?? 15,
    breakMinutes: series?.zoneBreakMinutes ?? 5,
    zoneCount,
  };
}

export const waveLengthFor = (timing: FloorTiming) => Math.max(1, waveLengthMinutes(timing));

/**
 * Record the finisher clock for every team that competed but was never
 * stopped: the time the wave had left when it ended — 0:00 when it ran out,
 * what was left when the supervisor ended it early. A time a judge captured
 * with End is never overwritten.
 *
 * "Competed" means the team has a score row at all — somebody entered
 * something for it. A no-show gets nothing invented for it.
 */
export async function fillFinisherTimes(
  db: Db,
  wave: { id: string; seriesId: string },
  remainingMs: number
): Promise<number> {
  const clockInputs = await db.zoneInput.findMany({
    where: { zone: { seriesId: wave.seriesId }, inputMode: { in: ["minutes", "seconds"] } },
    select: { id: true, inputMode: true },
  });
  const minutesId = clockInputs.find((one) => one.inputMode === "minutes")?.id;
  const secondsId = clockInputs.find((one) => one.inputMode === "seconds")?.id;
  if (!minutesId || !secondsId) return 0;

  const { minutes, seconds } = remainingClock(remainingMs);
  const scores = await db.score.findMany({
    where: { team: { waveId: wave.id, archivedAt: null } },
    select: { id: true, entries: { select: { inputId: true, value: true } } },
  });

  let filled = 0;
  for (const score of scores) {
    const timed = score.entries.some(
      (entry) => (entry.inputId === minutesId || entry.inputId === secondsId) && entry.value !== null
    );
    if (timed) continue;
    for (const [inputId, value] of [
      [minutesId, minutes],
      [secondsId, seconds],
    ] as const) {
      await db.zoneEntry.upsert({
        where: { scoreId_inputId: { scoreId: score.id, inputId } },
        create: { scoreId: score.id, inputId, value },
        update: { value },
      });
    }
    filled += 1;
  }
  return filled;
}
