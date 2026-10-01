import { Prisma } from "@/generated/prisma/client";
import { startBlockers, type TeamCheck, type TeamGaps } from "@/lib/readiness";
import { seatsOf, waiverStates } from "@/lib/waivers/waiver-db";

// ─────────────────────────────────────────────────────────────────────────────
// MAY THIS WAVE START? — asked by the one place a wave starts
// (actions/waves.ts › controlLocked), inside the competition's schedule lock.
//
// Every team holding a place in the wave, and every athlete on it, is read
// AFTER their rows are locked: an entrance or warm-up check-out, a move, a
// new member or a category change that is in flight either finished before
// this read or waits until the start is decided. What is read is what the
// wave starts with — or the reasons it cannot, by team and by athlete
// (readiness.ts). Nothing is dropped to make it startable.
// ─────────────────────────────────────────────────────────────────────────────

export async function waveStartBlockers(tx: Prisma.TransactionClient, waveId: string, seriesId: string): Promise<TeamGaps[]> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM Team WHERE waveId = ${waveId} FOR UPDATE`;
  if (!locked.length) return [];
  const ids = locked.map((row) => row.id);
  await tx.$queryRaw`SELECT id FROM Competitor WHERE teamId IN (${Prisma.join(ids)}) FOR UPDATE`;

  const teams = await tx.team.findMany({
    where: { id: { in: ids }, archivedAt: null, waitlistedAt: null },
    orderBy: { station: "asc" },
    select: { id: true, number: true, name: true, waveId: true, warmupReadyAt: true, warmupWaveId: true },
  });
  const seats = await seatsOf(tx, teams.map((team) => team.id));
  const states = await waiverStates(tx, seriesId, seats);
  const checks: TeamCheck[] = teams.map((team) => ({
    id: team.id, number: team.number, name: team.name, inField: true, waveId: team.waveId,
    readyForWaveId: team.warmupReadyAt ? team.warmupWaveId : null,
    athletes: seats.filter((seat) => seat.teamId === team.id).map((seat) => ({
      id: seat.competitorId, name: seat.fullName, waiver: states.get(seat.competitorId)!, arrived: Boolean(seat.attendedAt),
    })),
  }));
  return startBlockers(checks, waveId);
}
