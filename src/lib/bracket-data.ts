import "server-only";

import { isBft, type CurrentUser } from "@/lib/access";
import { bracketFacts, bracketSide, type BracketFacts } from "@/lib/bracket";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";

/**
 * What each team's "Change category or level" panel needs: the bracket it
 * has, whether the floor still lets it change, and which categories this pair
 * cannot enter — worked out by the same rules the server applies on save
 * (bracket.ts), so the panel never offers what would be refused.
 *
 * `by` is who is pressing — the athlete for their own team, or staff helping
 * them — which, with the account type, decides whose clock applies and
 * whether Pro is theirs to give.
 *
 * The caller passes ids it has ALREADY scoped (an athlete's own team, a
 * gym's own teams): this reads, it does not decide who may look.
 */
export async function loadBracketFacts(
  teamIds: string[],
  viewer: Pick<CurrentUser, "role">,
  by: "athlete" | "staff"
): Promise<Record<string, BracketFacts>> {
  if (!teamIds.length) return {};
  const who = { side: bracketSide(viewer, by), bft: by === "staff" && isBft(viewer) };
  const now = new Date();
  const { locale } = await getTranslator();
  // The cutoff as people read it: the competition's own time zone, their language.
  const when = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    timeZone: "Asia/Qatar", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
  const labelled = (facts: BracketFacts): BracketFacts => (facts.closesAt ? { ...facts, closesAtLabel: when.format(new Date(facts.closesAt)) } : facts);
  const teams = await prisma.team.findMany({
    where: { id: { in: teamIds } },
    select: {
      id: true, category: true, division: true, archivedAt: true, waveId: true,
      waveRef: { select: { status: true } },
      score: { select: { id: true } },
      series: { select: { status: true, archivedAt: true, competitionDate: true, teamEditCloseHours: true } },
      competitors: { select: { user: { select: { athleteProfile: { select: { sex: true } } } } } },
    },
  });
  return Object.fromEntries(
    teams.map((team) => [
      team.id,
      labelled(bracketFacts(
        {
          id: team.id, category: team.category, division: team.division,
          archivedAt: team.archivedAt, waveId: team.waveId, waveStatus: team.waveRef?.status ?? null,
          scored: Boolean(team.score), seriesStatus: team.series.status, seriesArchived: Boolean(team.series.archivedAt),
          competitionDate: team.series.competitionDate, closeHours: team.series.teamEditCloseHours,
          sexes: team.competitors.map((seat) => seat.user?.athleteProfile?.sex ?? null),
        },
        who,
        now
      )),
    ])
  );
}
