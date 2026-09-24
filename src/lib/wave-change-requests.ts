import "server-only";
import type { WaveChangeStatus } from "@/generated/prisma/enums";
import { can, isBft, type CurrentUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";

export const preferenceLabels = { morning: "Morning", midday: "Midday", evening: "Evening" } as const;

export async function countPendingWaveChanges(user: CurrentUser) {
  if (!isBft(user) || !can(user, "approvals.view")) return 0;
  return prisma.waveChangeRequest.count({ where: { status: "pending", series: { archivedAt: null } } });
}

export async function listWaveChangeRequests(user: CurrentUser, seriesId?: string, status: WaveChangeStatus | "all" = "pending") {
  if (!isBft(user) || !can(user, "approvals.view")) return [];
  const rows = await prisma.waveChangeRequest.findMany({
    where: { ...(seriesId ? { seriesId } : {}), ...(status !== "all" ? { status } : {}), series: { archivedAt: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      requestedBy: { select: { name: true, email: true } },
      series: { select: { name: true, status: true } },
      team: { select: { name: true, number: true, category: true, division: true, updatedAt: true,
        archivedAt: true, waitlistedAt: true, waveId: true, waveRef: true } },
    },
  });
  const waves = rows.length ? await prisma.wave.findMany({
    where: { seriesId: { in: [...new Set(rows.map(row => row.seriesId))] }, status: "pending" },
    orderBy: { number: "asc" },
    include: { teams: { select: { station: true } } },
  }) : [];
  return rows.map(row => ({
    id: row.id, seriesId: row.seriesId, seriesName: row.series.name,
    teamName: row.team.name, teamNumber: row.team.number, category: row.team.category, division: row.team.division,
    requester: row.requestedBy.name ?? row.requestedBy.email,
    preference: row.preference, note: row.note, status: row.status,
    createdAt: row.createdAt.toISOString(), rejectionReason: row.rejectionReason,
    fromWaveNumber: row.fromWaveNumber, fromStartTime: row.fromStartTime,
    toWaveNumber: row.toWaveNumber, toStartTime: row.toStartTime,
    currentWaveNumber: row.team.waveRef?.number ?? null, currentStartTime: row.team.waveRef?.startTime ?? null,
    teamVersion: row.team.updatedAt.toISOString(),
    sourceWaveVersion: row.team.waveRef?.updatedAt.toISOString() ?? null,
    sourceWaveId: row.team.waveId,
    eligible: !row.team.archivedAt && !row.team.waitlistedAt && row.team.waveRef?.status === "pending" && row.series.status !== "final",
    waves: waves.filter(wave => wave.seriesId === row.seriesId && wave.id !== row.team.waveId).map(wave => ({
      id: wave.id, number: wave.number, startTime: wave.startTime, capacity: wave.capacity,
      occupied: wave.teams.length, version: wave.updatedAt.toISOString(),
    })),
  }));
}

export type WaveChangeRow = Awaited<ReturnType<typeof listWaveChangeRequests>>[number];

export async function teamWaveChangeHistory(teamId: string, userId: string) {
  const rows = await prisma.waveChangeRequest.findMany({
    where: { teamId, team: { archivedAt: null, competitors: { some: { userId } } } },
    orderBy: { createdAt: "desc" },
    select: { id: true, preference: true, note: true, status: true, rejectionReason: true,
      toWaveNumber: true, toStartTime: true, createdAt: true },
  });
  return rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export type TeamWaveChange = Awaited<ReturnType<typeof teamWaveChangeHistory>>[number];
