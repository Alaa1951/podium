import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveShirtSize, type ShirtSeat } from "@/lib/shirts";

/** Every seat on a team still entered in the competition, with its resolved shirt size (shirts.ts). */
export async function getShirtSeats(seriesId: string, scope: Prisma.TeamWhereInput = {}): Promise<ShirtSeat[]> {
  const teams = await prisma.team.findMany({
    where: { seriesId, archivedAt: null, ...scope },
    orderBy: { number: "asc" },
    select: {
      number: true,
      name: true,
      category: true,
      division: true,
      station: true,
      waitlistedAt: true,
      waveRef: { select: { number: true } },
      studio: { select: { name: true } },
      competitors: {
        orderBy: { position: "asc" },
        select: { position: true, fullName: true, shirtSize: true, userId: true },
      },
    },
  });

  const userIds = [...new Set(teams.flatMap((team) => team.competitors.map((seat) => seat.userId)).filter((id): id is string => !!id))];
  const [signups, profiles] = userIds.length
    ? await Promise.all([
        prisma.seriesParticipant.findMany({
          where: { seriesId, userId: { in: userIds } },
          select: { userId: true, shirtSize: true, partnerShirtSize: true },
        }),
        prisma.athleteProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, shirtSize: true } }),
      ])
    : [[], []];
  const signupBy = new Map(signups.map((row) => [row.userId, row]));
  const profileBy = new Map(profiles.map((row) => [row.userId, row.shirtSize]));

  return teams.flatMap((team) => {
    const registrant = team.competitors.find((seat) => seat.position === 1);
    return team.competitors.map((seat) => {
      const own = seat.userId ? signupBy.get(seat.userId) : undefined;
      // A partner with no account of their own: what the registering athlete
      // typed for them when signing up.
      const partner =
        !seat.userId && seat.position !== 1 && registrant?.userId ? signupBy.get(registrant.userId)?.partnerShirtSize ?? null : null;
      const { size, source } = resolveShirtSize({
        seat: seat.shirtSize,
        signup: own?.shirtSize ?? null,
        partner,
        profile: seat.userId ? profileBy.get(seat.userId) ?? null : null,
      });
      return {
        teamNumber: team.number,
        teamName: team.name,
        athlete: seat.fullName,
        studio: team.studio?.name ?? null,
        category: team.category,
        division: team.division,
        waveNumber: team.waitlistedAt ? null : team.waveRef?.number ?? null,
        station: team.waitlistedAt ? null : team.station,
        waitlisted: !!team.waitlistedAt,
        size,
        source,
      };
    });
  });
}

/** Signed up for the competition but not on any entered team yet — listed, never counted. */
export async function getShirtSignupsWithoutTeam(seriesId: string) {
  const seated = await prisma.competitor.findMany({
    where: { team: { seriesId, archivedAt: null }, NOT: { userId: null } },
    select: { userId: true },
  });
  const onATeam = seated.map((row) => row.userId!).filter(Boolean);
  return prisma.seriesParticipant.findMany({
    where: { seriesId, archivedAt: null, ...(onATeam.length ? { userId: { notIn: onATeam } } : {}) },
    orderBy: { signedUpAt: "asc" },
    select: { shirtSize: true, user: { select: { name: true, email: true } } },
  });
}
