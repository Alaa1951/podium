import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { competitionChoices } from "@/lib/competition-choice";
import { prisma } from "@/lib/prisma";

export type ParticipationDb = Pick<Prisma.TransactionClient, "seriesParticipant" | "user" | "competitor" | "series">;

/** Identity defaults are copied only when joining; another event's partner never is. */
export async function ensureParticipation(userId: string, seriesId: string, db: ParticipationDb = prisma) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { athleteProfile: true } });
  if (!user || user.archivedAt || user.status === "disabled") throw new Error("ATHLETE_NOT_FOUND");
  const profile = user.athleteProfile;
  return db.seriesParticipant.upsert({
    where: { seriesId_userId: { seriesId, userId } },
    update: {},
    create: {
      seriesId, userId,
      division: profile?.division, category: profile?.category,
      shirtSize: profile?.shirtSize, bftMember: profile?.bftMember ?? false,
      lookingForPartner: true,
    },
  });
}

export async function loadSeriesAthlete(userId: string, seriesId: string, db: ParticipationDb = prisma) {
  const participation = await db.seriesParticipant.findUnique({
    where: { seriesId_userId: { seriesId, userId } },
    include: { user: { include: { athleteProfile: true } } },
  });
  if (!participation || participation.archivedAt) return null;
  const { user, ...entry } = participation;
  return {
    ...user,
    signupAt: entry.signedUpAt,
    athleteProfile: { ...user.athleteProfile, ...entry, dateOfBirth: user.athleteProfile?.dateOfBirth ?? null, sex: user.athleteProfile?.sex ?? null },
  };
}

export async function listMySeries(userId: string) {
  return prisma.series.findMany({
    where: {
      archivedAt: null,
      OR: [
        { participants: { some: { userId, archivedAt: null } } },
        { teams: { some: { archivedAt: null, competitors: { some: { userId } } } } },
      ],
    },
    orderBy: { competitionDate: "desc" },
  });
 }

/**
 * Explicit writes always supply an id. Landing pages default to the
 * competition the athlete actually holds a seat in (a real one before a
 * training one), and only then to "running, then upcoming" — a training
 * event left running must not hide the entry they came to see.
 */
export async function resolveMySeries(userId: string, requested?: string) {
  const series = competitionChoices(await listMySeries(userId));
  if (requested) return series.find(s => s.id === requested || s.slug === requested) ?? null;
  const seated = new Set(
    (await prisma.competitor.findMany({
      where: { userId, team: { archivedAt: null, series: { archivedAt: null } } },
      select: { team: { select: { seriesId: true } } },
    })).map((row) => row.team.seriesId)
  );
  return series.find(s => seated.has(s.id) && !s.isTraining) ?? series.find(s => seated.has(s.id)) ?? series[0] ?? null;
}

export function meHref(seriesId: string, suffix = "") {
  return `/me${suffix}?series=${encodeURIComponent(seriesId)}`;
}
