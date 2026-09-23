import "server-only";

import { prisma as defaultPrisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// ONE PERSON, ONE ENTRY IN A COMPETITION.
//
// This check was written out by hand four times — self sign-up, studio
// pairing, swapping somebody onto a team, and naming a partner — and left out
// of the two paths that create the most entries: the by-hand registration
// form and the CRM sync. Those two key on nothing and on `externalId`
// respectively, and `externalId` is NULL on every team the other paths make.
// MariaDB treats each NULL in a unique index as distinct, so nothing collided
// and nothing complained.
//
// WHAT A DUPLICATE COSTS, which is why this is worth a module of its own: it
// is invisible until payment is confirmed, and then the same two people are
// two rows on the board, two ranks in the published results, two of every
// figure in the reports — money, members, shirt sizes — and a rig dealt to a
// pair who are already standing on another one. `/me` then picks between the
// two teams with an unordered `findFirst`, so the athlete may edit the entry
// that is not the one competing.
//
// EMAILS ARE LOWERCASED HERE and not left to the caller. Every writer in the
// project stores them lowercased; one of the four copies passed them through
// as typed, which made that copy depend on the column's collation to work at
// all.
// ─────────────────────────────────────────────────────────────────────────────

type Db = Pick<typeof defaultPrisma, "competitor">;

export type EntrySearch = {
  seriesId: string;
  /** Accounts to look for. */
  userIds?: (string | null | undefined)[];
  /** Addresses to look for, in any case. */
  emails?: (string | null | undefined)[];
  /** A seat to ignore — the one being replaced, when swapping somebody in. */
  exceptCompetitorId?: string;
};

/**
 * The seat this person already holds in this competition, or null.
 *
 * Returns enough to say WHO and WHICH TEAM rather than a bare boolean,
 * because the CRM sync does not want to refuse — it wants to recognise the
 * team it is looking at and adopt it instead of making a second one.
 *
 * Archived entries do not count: a withdrawn pair may enter again.
 */
export async function findEntryInSeries(
  search: EntrySearch,
  db: Db = defaultPrisma
): Promise<{ competitorId: string; teamId: string; email: string | null; userId: string | null } | null> {
  const userIds = (search.userIds ?? []).filter((id): id is string => Boolean(id));
  const emails = (search.emails ?? [])
    .filter((email): email is string => Boolean(email))
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

  // Nothing to look for is not the same as "nobody is entered". Returning
  // null on an empty search is right, but an OR with no branches matches
  // EVERY row — which would report the first competitor in the event as a
  // duplicate of everyone.
  if (userIds.length === 0 && emails.length === 0) return null;

  const or = [
    ...(userIds.length ? [{ userId: { in: userIds } }] : []),
    ...(emails.length ? [{ email: { in: emails } }] : []),
  ];

  const found = await db.competitor.findFirst({
    where: {
      team: { seriesId: search.seriesId, archivedAt: null },
      ...(search.exceptCompetitorId ? { NOT: { id: search.exceptCompetitorId } } : {}),
      OR: or,
    },
    select: { id: true, teamId: true, email: true, userId: true },
  });

  return found
    ? { competitorId: found.id, teamId: found.teamId, email: found.email, userId: found.userId }
    : null;
}

/** The boolean form, for the paths that only need to refuse. */
export async function alreadyEntered(search: EntrySearch, db: Db = defaultPrisma): Promise<boolean> {
  return (await findEntryInSeries(search, db)) !== null;
}
