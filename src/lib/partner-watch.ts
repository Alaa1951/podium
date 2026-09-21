import "server-only";

import type { Category, Division } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// WHO STILL HAS NOBODY — the staff's view.
//
// `partner-directory.ts` is an ATHLETE reading another athlete: four fields,
// no contact details, and a test that walks the select and fails if one ever
// appears. THIS is staff reading the same people, and the whole point is a
// phone number, because the job is to ring somebody and pair them up.
//
// Two modules, two selects, two tests — and nothing here imports from the
// directory. That separation is exactly why the directory's privacy test still
// means something: widening this file cannot widen that one.
//
// MEMBERSHIP OF A COMPETITION, in one place. An athlete belongs to this
// competition's watch when either is true:
//   • they chose it at sign-up (`requestedSeriesId`), or
//   • somebody has already entered them in a team in it.
// The second branch is what stops an athlete who arrived through the CRM from
// being invisible here.
// ─────────────────────────────────────────────────────────────────────────────

export type PartnerWatchPerson = {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  division: Division | null;
  category: Category | null;
  studioName: string | null;
};

export type PartnerWatchAsk = {
  id: string;
  from: PartnerWatchPerson;
  to: PartnerWatchPerson;
  sentAt: Date;
};

export type PartnerWatchPair = {
  a: PartnerWatchPerson;
  b: PartnerWatchPerson;
  linkedAt: Date | null;
};

export type PartnerWatch = {
  /** Said they are looking, and nobody has been matched to them. */
  looking: PartnerWatchPerson[];
  /** In this competition by sign-up, with no team entered for them. */
  unteamed: PartnerWatchPerson[];
  /** Asked somebody, or been asked, and waiting on an answer. */
  asking: PartnerWatchAsk[];
  /** Found each other and nobody has registered them. The useful one. */
  pairedNotRegistered: PartnerWatchPair[];
};

const LIMIT = 500;

/** The fields staff need to act: who they are, and how to reach them. */
const personSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  studio: { select: { name: true } },
  athleteProfile: { select: { division: true, category: true } },
} as const;

type PersonRow = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  studio: { name: string } | null;
  athleteProfile: { division: Division | null; category: Category | null } | null;
};

const shape = (row: PersonRow): PartnerWatchPerson => ({
  userId: row.id,
  name: row.name ?? row.email,
  email: row.email,
  phone: row.phone,
  division: row.athleteProfile?.division ?? null,
  category: row.athleteProfile?.category ?? null,
  studioName: row.studio?.name ?? null,
});

/** Everybody this competition's watch covers, before any per-list filter. */
function inThisCompetition(seriesId: string) {
  return {
    role: "competitor" as const,
    approvalStatus: "approved" as const,
    archivedAt: null,
    status: { not: "disabled" as const },
    OR: [
      { requestedSeriesId: seriesId },
      { competitors: { some: { team: { seriesId, archivedAt: null } } } },
    ],
  };
}

const hasNoTeam = (seriesId: string) => ({
  competitors: { none: { team: { seriesId, archivedAt: null } } },
});

export async function getPartnerWatch(params: {
  seriesId: string;
  /** A studio sees its own people; BFT MENA passes null and sees everyone. */
  studioId: string | null;
}): Promise<PartnerWatch> {
  const { seriesId, studioId } = params;
  const base = inThisCompetition(seriesId);
  const mine = studioId ? { studioId } : {};

  const [looking, unteamed, asks, paired] = await Promise.all([
    prisma.user.findMany({
      where: {
        ...base,
        ...mine,
        athleteProfile: { is: { lookingForPartner: true, partnerUserId: null } },
      },
      orderBy: { name: "asc" },
      take: LIMIT,
      select: personSelect,
    }),
    prisma.user.findMany({
      where: { ...base, ...mine, ...hasNoTeam(seriesId) },
      orderBy: { name: "asc" },
      take: LIMIT,
      select: personSelect,
    }),
    // At least one side in this competition: "these two are talking, and one
    // of them is mine" is the fact worth surfacing.
    prisma.partnerRequest.findMany({
      where: {
        status: "pending",
        OR: [
          { from: { ...base, ...mine } },
          { to: { ...base, ...mine } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      select: {
        id: true,
        createdAt: true,
        from: { select: personSelect },
        to: { select: personSelect },
      },
    }),
    // Linked to each other, neither on a team here. `userId < partnerUserId`
    // keeps one row per pair rather than the same pair twice.
    prisma.athleteProfile.findMany({
      where: {
        partnerUserId: { not: null },
        user: { ...base, ...hasNoTeam(seriesId) },
        // A studio sees a pair when EITHER side is its own: two athletes who
        // found each other across studios belong to both lists, not neither.
        ...(studioId
          ? { OR: [{ user: { studioId } }, { partner: { studioId } }] }
          : {}),
        partner: { ...base, ...hasNoTeam(seriesId) },
      },
      orderBy: { partnerLinkedAt: "desc" },
      take: LIMIT,
      select: {
        userId: true,
        partnerUserId: true,
        partnerLinkedAt: true,
        user: { select: personSelect },
        partner: { select: personSelect },
      },
    }),
  ]);

  return {
    looking: looking.map(shape),
    unteamed: unteamed.map(shape),
    asking: asks.map((row) => ({
      id: row.id,
      from: shape(row.from),
      to: shape(row.to),
      sentAt: row.createdAt,
    })),
    pairedNotRegistered: paired
      .filter((row) => row.partnerUserId && row.userId < row.partnerUserId && row.partner)
      .map((row) => ({
        a: shape(row.user),
        b: shape(row.partner!),
        linkedAt: row.partnerLinkedAt,
      })),
  };
}

/**
 * How many pairs are waiting to be entered — the badge on the menu.
 *
 * This is the list that costs a competition entries if nobody looks at it:
 * two people who agreed, and nothing happened.
 */
export async function countPairedNotRegistered(seriesId: string): Promise<number> {
  const base = inThisCompetition(seriesId);
  const rows = await prisma.athleteProfile.findMany({
    where: {
      partnerUserId: { not: null },
      user: { ...base, ...hasNoTeam(seriesId) },
      partner: { ...base, ...hasNoTeam(seriesId) },
    },
    select: { userId: true, partnerUserId: true },
    take: LIMIT,
  });
  return rows.filter((row) => row.partnerUserId && row.userId < row.partnerUserId).length;
}
