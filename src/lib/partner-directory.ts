import "server-only";

import type { Category, Division } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// WHO ELSE IS LOOKING FOR A PARTNER.
//
// This is the one read in the whole system where an athlete sees another
// athlete. Everywhere else a competitor's reach is their own row —
// `accountScope` returns `{ id: user.id }` for them, and deliberately so. That
// is why this lives in its own module with its own narrow query rather than
// widening a shared helper: there is exactly one door, and it is this one.
//
// WHAT LEAVES THE SERVER is the four things somebody needs to decide whether to
// ask: a name, a level, a category, a studio. No email, no phone, no date of
// birth, no gender. Contact details are exchanged when the two agree and not
// before — `linkPair` does that, on acceptance.
//
// The test beside this file walks the `select` below and fails if any of those
// fields ever appear in it. That is the guard that matters: the realistic way
// this promise breaks is somebody widening the select for a good reason.
// ─────────────────────────────────────────────────────────────────────────────

/** Everything the finder shows about somebody. Five fields, and no more. */
export type PartnerCandidate = {
  /** Their account id — opaque, and all that is needed to ask them. */
  id: string;
  name: string;
  division: Division | null;
  category: Category | null;
  /** Null when they belong to no studio, which is allowed and common. */
  studioName: string | null;
};

export type PartnerCandidatePage = {
  rows: PartnerCandidate[];
  total: number;
};

/** How many candidates one page shows. */
export const CANDIDATES_PER_PAGE = 25;

/**
 * The ids this athlete must not be offered: anyone they are mid-conversation
 * with, and anyone who has already turned them down.
 *
 * A `declined` row where THEY asked ME is not here. Turning somebody down once
 * is not a promise never to change your mind, and the person who declined
 * keeps the right to ask later.
 */
async function relatedIds(userId: string, seriesId: string): Promise<string[]> {
  const rows = await prisma.partnerRequest.findMany({
    where: {
      seriesId,
      OR: [{ fromUserId: userId }, { toUserId: userId }],
      status: { in: ["pending", "accepted", "declined"] },
    },
    select: { fromUserId: true, toUserId: true, status: true },
  });

  const out = new Set<string>();
  for (const row of rows) {
    const other = row.fromUserId === userId ? row.toUserId : row.fromUserId;
    if (row.status === "pending" || row.status === "accepted") out.add(other);
    // Only a refusal of MY asking closes the door on me asking again.
    else if (row.fromUserId === userId) out.add(other);
  }
  return [...out];
}

/**
 * The athletes at this person's own level and category who are looking.
 *
 * Level and category are the athlete's own and are not negotiable — a pair
 * competes in one bracket, so showing anybody else would be offering a team
 * that cannot be entered.
 */
export async function listPartnerCandidates(params: {
  me: { id: string; seriesId: string; division: Division; category: Category };
  /** Name search. Empty string means no search. */
  query: string;
  page: number;
}): Promise<PartnerCandidatePage> {
  const search = params.query.trim();
  const excluded = await relatedIds(params.me.id, params.me.seriesId);

  const where = {
    seriesId: params.me.seriesId, archivedAt: null,
    // The three columns of @@index([lookingForPartner, division, category]),
    // all as equality, which is the whole reason that index exists.
    lookingForPartner: true,
    division: params.me.division,
    category: params.me.category,
    // Belt and braces: linkPair clears the flag, but a row that somehow held
    // both must never be offered.
    partnerUserId: null,
    userId: { notIn: [params.me.id, ...excluded] },
    user: {
      role: "competitor" as const,
      approvalStatus: "approved" as const,
      archivedAt: null,
      status: { not: "disabled" as const },
      // MariaDB's utf8mb4_unicode_ci makes this case-insensitive already.
      // Prisma's `mode: "insensitive"` is Postgres-only and would throw here.
      ...(search ? { name: { contains: search } } : {}),
    },
  };

  const [rows, total] = await Promise.all([
    prisma.seriesParticipant.findMany({
      where,
      orderBy: { user: { name: "asc" } },
      skip: Math.max(0, params.page) * CANDIDATES_PER_PAGE,
      take: CANDIDATES_PER_PAGE,
      select: {
        userId: true,
        division: true,
        category: true,
        user: { select: { name: true, studio: { select: { name: true } } } },
      },
    }),
    prisma.seriesParticipant.count({ where }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.userId,
      // An approved athlete always has a name from sign-up. The fallback is a
      // word, never their address — "we only send the email as a fallback" is
      // how a promise like this one dies.
      name: row.user.name ?? "",
      division: row.division,
      category: row.category,
      studioName: row.user.studio?.name ?? null,
    })),
    total,
  };
}

/**
 * Is this one person still a legitimate thing to ask? Re-checked on the server
 * when a request is sent, so knowing an id from anywhere else buys nothing.
 */
export async function partnerCandidateExists(params: {
  me: { id: string; seriesId: string; division: Division; category: Category };
  toUserId: string;
}): Promise<boolean> {
  const found = await prisma.seriesParticipant.findFirst({
    where: {
      seriesId: params.me.seriesId, archivedAt: null,
      userId: params.toUserId,
      lookingForPartner: true,
      division: params.me.division,
      category: params.me.category,
      partnerUserId: null,
      user: {
        role: "competitor",
        approvalStatus: "approved",
        archivedAt: null,
        status: { not: "disabled" },
      },
    },
    select: { userId: true },
  });
  return Boolean(found);
}
