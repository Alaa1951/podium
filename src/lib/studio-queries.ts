import "server-only";
import { cache } from "react";

import { prisma } from "@/lib/prisma";
import { NO_MATCH, type CurrentUser } from "@/lib/access";

// Reads for the studio dashboard. A studio account is only ever asking about
// itself, so every function here takes the user and derives the studio from the
// session — never from anything on the request.

/**
 * The competitions this studio is taking part in, soonest first.
 *
 * Taking part means a SeriesStudio row: BFT MENA decides who is in a series,
 * and a studio that has not been added sees nothing rather than seeing an empty
 * dashboard for a competition it is not in.
 */
export async function getStudioSeries(user: CurrentUser, slug?: string) {
  const studioId = user.studioId ?? NO_MATCH;

  const rows = await prisma.seriesStudio.findMany({
    where: { studioId, ...(slug ? { series: { slug } } : {}) },
    orderBy: { series: { competitionDate: "desc" } },
    select: {
      series: {
        select: {
          id: true,
          slug: true,
          name: true,
          competitionDate: true,
          status: true,
          venue: true,
          studiosMayEnterScores: true,
          registrationClosesAt: true,
          registrationsFinalAt: true,
          scoreEntryClosesAt: true,
          resultsPublicAt: true,
          championsAnnouncedAt: true,
          studioScoreCorrections: true,
        },
      },
    },
  });

  const series = rows.map((row) => row.series);

  // How many of the studio's own teams are in each, for the picker.
  const counts = await prisma.team.groupBy({
    by: ["seriesId"],
    where: { studioId, seriesId: { in: series.map((s) => s.id) } },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((c) => [c.seriesId, c._count._all]));

  return series.map((s) => ({ ...s, teamCount: byId.get(s.id) ?? 0 }));
}

/** One of those competitions, by the slug in the URL. Null if not theirs. */
export const getStudioSeriesBySlug = cache(async (user: CurrentUser, slug: string) => {
  // A tab in one competition must not load/count every competition the studio
  // has ever entered. Membership and studio scoping remain part of the query.
  const matching = await getStudioSeries(user, slug);
  return matching[0] ?? null;
});
