import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ScheduleError, scheduledTime } from "@/lib/wave-schedule";

/** All schedule writers use the same lock order. The wave locks also protect
 * against a clock transition while checking whether a move is still allowed. */
export function scheduleTransaction<T>(seriesId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Series WHERE id = ${seriesId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM Wave WHERE seriesId = ${seriesId} ORDER BY id FOR UPDATE`;
    return work(tx);
  }, { timeout: 30_000 });
}

export async function waveRowFor(tx: Prisma.TransactionClient, seriesId: string, number: number) {
  const existing = await tx.wave.findUnique({ where: { seriesId_number: { seriesId, number } } });
  if (existing) return existing;
  const series = await tx.series.findUnique({ where: { id: seriesId } });
  if (!series || series.archivedAt) throw new ScheduleError("NOT_FOUND");
  if (series.status === "final") throw new ScheduleError("SERIES_FINISHED");
  const index = await tx.wave.count({ where: { seriesId, number: { lt: number } } });
  return tx.wave.create({ data: {
    seriesId, number, capacity: series.waveCapacity, durationMinutes: series.waveMinutes,
    startTime: scheduledTime(series.firstWaveTime, series.waveIntervalMinutes, index),
  } });
}
