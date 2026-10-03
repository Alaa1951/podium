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
 * The caller's transaction holds each Team lock through its wave transition.
 */
export async function fillFinisherTimes(
  db: Prisma.TransactionClient,
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
    orderBy: { teamId: "asc" },
    select: { teamId: true },
  });

  let filled = 0;
  for (const score of scores) {
    await db.$queryRaw`SELECT id FROM Team WHERE id = ${score.teamId} FOR UPDATE`;
    // A sweep may already have opened a REPEATABLE READ snapshot before
    // waiting for this team. FOR UPDATE is a current read, so it sees a judge's
    // captured time committed while we waited instead of overwriting it.
    const current = await db.$queryRaw<{ id: string; updatedAt: Date; inputId: string | null; value: number | null }[]>`
      SELECT s.id, s.updatedAt, e.inputId, e.value
      FROM Score s LEFT JOIN ZoneEntry e ON e.scoreId = s.id
      WHERE s.teamId = ${score.teamId}
      FOR UPDATE
    `;
    if (!current.length) continue;
    const timed = current.some(
      (entry) => (entry.inputId === minutesId || entry.inputId === secondsId) && entry.value !== null
    );
    if (timed) continue;
    for (const [inputId, value] of [
      [minutesId, minutes],
      [secondsId, seconds],
    ] as const) {
      await db.zoneEntry.upsert({
        where: { scoreId_inputId: { scoreId: current[0].id, inputId } },
        create: { scoreId: current[0].id, inputId, value },
        update: { value },
      });
    }
    // Clock autofill changes the same snapshot as manual score entry. Bump
    // its revision from the current locked read, even within one millisecond.
    const revision = new Date(Math.max(Date.now(), current[0].updatedAt.getTime() + 1));
    await db.score.update({ where: { id: current[0].id }, data: { updatedAt: revision } });
    filled += 1;
  }
  return filled;
}
