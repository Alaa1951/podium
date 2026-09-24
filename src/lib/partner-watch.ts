import "server-only";
import type { Category, Division } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
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


export async function getPartnerWatch({ seriesId, studioId }: { seriesId: string; studioId: string | null }): Promise<PartnerWatch> {
  const [entries, seats, requests] = await Promise.all([
    prisma.seriesParticipant.findMany({ where: { seriesId, archivedAt: null, user: { role: "competitor", approvalStatus: "approved", archivedAt: null, status: "active" } },
      include: { user: { select: { id: true, name: true, email: true, phone: true, studioId: true, studio: { select: { name: true } } } } }, orderBy: { user: { name: "asc" } } }),
    prisma.competitor.findMany({ where: { userId: { not: null }, team: { seriesId, archivedAt: null } }, select: { userId: true } }),
    prisma.partnerRequest.findMany({ where: { seriesId, status: "pending" }, orderBy: { createdAt: "desc" } }),
  ]);
  const teamed = new Set(seats.map(p => p.userId));
  const byId = new Map(entries.map(p => [p.userId, p]));
  type Entry = (typeof entries)[number];
  const mine = (p: Entry) => !studioId || p.user.studioId === studioId;
  const person = (p: Entry): PartnerWatchPerson => ({ userId: p.userId, name: p.user.name ?? p.user.email, email: p.user.email, phone: p.user.phone,
    division: p.division, category: p.category, studioName: p.user.studio?.name ?? null });
  return {
    looking: entries.filter(p => mine(p) && p.lookingForPartner && !p.partnerUserId && !teamed.has(p.userId)).map(person),
    unteamed: entries.filter(p => mine(p) && !teamed.has(p.userId)).map(person),
    asking: requests.flatMap(r => { const from = byId.get(r.fromUserId), to = byId.get(r.toUserId);
      return from && to && (mine(from) || mine(to)) ? [{ id: r.id, from: person(from), to: person(to), sentAt: r.createdAt }] : []; }),
    pairedNotRegistered: entries.flatMap(p => {
      const partner = p.partnerUserId ? byId.get(p.partnerUserId) : null;
      return partner && partner.partnerUserId === p.userId && p.userId < partner.userId && !teamed.has(p.userId) && !teamed.has(partner.userId) && (mine(p) || mine(partner))
        ? [{ a: person(p), b: person(partner), linkedAt: p.partnerLinkedAt }] : [];
    }),
  };
}

export async function countPairedNotRegistered(seriesId: string) {
  return (await getPartnerWatch({ seriesId, studioId: null })).pairedNotRegistered.length;
}
