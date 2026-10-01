import "server-only";

import { cache } from "react";

import { prisma } from "@/lib/prisma";
import { waiverState, type WaiverState } from "@/lib/waivers/status";

// ─────────────────────────────────────────────────────────────────────────────
// AN ATHLETE'S OWN WAIVERS — every competition they hold a seat in that
// requires one: its active version, their state, and their own signed
// records (receipts). Read for the signed-in account only; there is no way to
// ask for somebody else's.
// ─────────────────────────────────────────────────────────────────────────────

export type MyWaiver = {
  series: { id: string; name: string; slug: string; competitionDate: Date; status: string; isTraining: boolean };
  team: { id: string; number: number; name: string; category: "Womens" | "Mens" | "Mixed"; division: "Rookie" | "Open" | "Pro" };
  release: { id: string; version: number; editions: { id: string; language: "en" | "ar" }[] };
  state: WaiverState;
  /** Newest first. */
  signed: { id: string; version: number; language: "en" | "ar"; acceptedAt: Date; category: string; division: string; current: boolean }[];
};

export const myWaivers = cache(async (userId: string): Promise<MyWaiver[]> => {
  const seats = await prisma.competitor.findMany({
    where: { userId, team: { archivedAt: null, series: { archivedAt: null } } },
    select: {
      team: {
        select: {
          id: true, number: true, name: true, category: true, division: true,
          series: { select: { id: true, name: true, slug: true, competitionDate: true, status: true, isTraining: true } },
        },
      },
    },
  });
  if (!seats.length) return [];
  const seriesIds = [...new Set(seats.map((seat) => seat.team.series.id))];
  const [releases, acceptances] = await Promise.all([
    prisma.waiverRelease.findMany({
      where: { seriesId: { in: seriesIds }, status: "active" },
      select: { id: true, seriesId: true, version: true, editions: { select: { id: true, language: true } } },
    }),
    prisma.waiverAcceptance.findMany({
      where: { userId, seriesId: { in: seriesIds } },
      orderBy: { acceptedAt: "desc" },
      select: { id: true, seriesId: true, releaseId: true, language: true, acceptedAt: true, category: true, division: true, release: { select: { version: true } } },
    }),
  ]);
  return seats.flatMap((seat): MyWaiver[] => {
    const series = seat.team.series;
    const release = releases.find((one) => one.seriesId === series.id);
    if (!release) return [];
    const mine = acceptances.filter((one) => one.seriesId === series.id);
    const state = waiverState({ release, userId, acceptances: mine });
    return [{
      series: { id: series.id, name: series.name, slug: series.slug, competitionDate: series.competitionDate, status: series.status, isTraining: series.isTraining },
      team: { id: seat.team.id, number: seat.team.number, name: seat.team.name, category: seat.team.category, division: seat.team.division },
      release: { id: release.id, version: release.version, editions: release.editions },
      state,
      signed: mine.map((one) => ({
        id: one.id, version: one.release.version, language: one.language, acceptedAt: one.acceptedAt, category: one.category, division: one.division,
        current: one.releaseId === release.id,
      })),
    }];
  });
});

/** What still needs this person's signature — for the prompt on every page. */
export async function pendingWaivers(userId: string): Promise<MyWaiver[]> {
  return (await myWaivers(userId)).filter((one) => one.series.status !== "final" && (one.state === "pending" || one.state === "resign"));
}
