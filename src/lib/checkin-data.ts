import "server-only";

import { teamScope, type CurrentUser } from "@/lib/access";
import type { CheckInTeam, WarmupWave } from "@/lib/checkin";
import { onTheFloor } from "@/lib/ownership";
import { prisma } from "@/lib/prisma";

/**
 * The field as the two check-in screens read it: every team holding a place
 * (not withdrawn, not on the waiting list) that this person may see —
 * `teamScope`, so a gym gets its own teams and nobody else's — with each
 * athlete's own arrival and the team's warm-up readiness side by side.
 *
 * Paid or not: a pair paying at the door still has to be found on the list.
 */
export async function loadCheckIn(
  seriesId: string,
  user: Pick<CurrentUser, "id" | "role" | "studioId">
): Promise<{ teams: CheckInTeam[]; waves: WarmupWave[] }> {
  const [teams, waves] = await Promise.all([
    prisma.team.findMany({
      where: { seriesId, archivedAt: null, waitlistedAt: null, ...teamScope(user) },
      orderBy: { number: "asc" },
      select: {
        id: true, number: true, name: true, category: true, division: true,
        paymentStatus: true, waitlistedAt: true, waveId: true, station: true, warmupReadyAt: true,
        studio: { select: { name: true } },
        waveRef: { select: { number: true } },
        competitors: {
          orderBy: { position: "asc" },
          select: { id: true, fullName: true, attendedAt: true, user: { select: { name: true } } },
        },
      },
    }),
    prisma.wave.findMany({
      where: { seriesId },
      orderBy: { number: "asc" },
      select: { id: true, number: true, startTime: true, status: true },
    }),
  ]);

  return {
    waves,
    teams: teams.map((team) => ({
      id: team.id,
      number: team.number,
      name: team.name,
      category: team.category,
      division: team.division,
      studio: team.studio?.name ?? null,
      waveId: team.waveId,
      waveNumber: team.waveId ? team.waveRef?.number ?? null : null,
      station: team.station,
      competing: onTheFloor(team),
      athletes: team.competitors.map((seat) => ({
        id: seat.id,
        fullName: seat.user?.name ?? seat.fullName,
        arrived: seat.attendedAt !== null,
      })),
      ready: team.warmupReadyAt !== null,
    })),
  };
}
