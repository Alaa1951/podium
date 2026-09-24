import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
const normalizeEmail = (email: string) => email.trim().toLowerCase();

type Db = Pick<Prisma.TransactionClient, "seriesParticipant" | "user">;

/** A partner belongs to an entry, never to every competition on an account. */
export async function linkPair(a: string, b: string, seriesId: string, db: Db = prisma) {
  if (a === b) throw new Error("SAME_ATHLETE");
  const perform = async (tx: Db) => {
    const ids = [a, b].sort();
    const rows = await tx.seriesParticipant.findMany({
      where: { seriesId, userId: { in: ids }, archivedAt: null },
      include: { user: { include: { athleteProfile: true } } },
    });
    if (rows.length !== 2 || rows.some(p => p.user.archivedAt || p.user.status === "disabled")) throw new Error("NOT_FOUND");
    for (const id of ids) {
      const other = rows.find(p => p.userId !== id)!;
      const changed = await tx.seriesParticipant.updateMany({
        where: { seriesId, userId: id, archivedAt: null, OR: [{ partnerUserId: null }, { partnerUserId: other.userId }] },
        data: {
          partnerUserId: other.userId, partnerLinkedAt: new Date(), lookingForPartner: false,
          partnerName: other.user.name, partnerEmail: other.user.email, partnerPhone: other.user.phone,
          partnerDateOfBirth: other.user.athleteProfile?.dateOfBirth,
          partnerSex: other.user.athleteProfile?.sex,
          partnerShirtSize: other.shirtSize, partnerBftMember: other.bftMember,
        },
      });
      if (changed.count !== 1) throw new Error("ALREADY_LINKED");
    }
  };
  if (db === prisma) await prisma.$transaction(perform);
  else await perform(db);
}

export async function unlinkPair(a: string, b: string, seriesId: string, db: Db = prisma) {
  const perform = async (tx: Db) => {
    for (const [self, other] of [[a, b], [b, a]]) {
      await tx.seriesParticipant.updateMany({
        where: { seriesId, userId: self, OR: [{ partnerUserId: other }, { partnerUserId: null }] },
        data: { partnerUserId: null, partnerLinkedAt: null, lookingForPartner: true, teamName: null,
          partnerName: null, partnerEmail: null, partnerPhone: null, partnerDateOfBirth: null,
          partnerSex: null, partnerShirtSize: null, partnerBftMember: false },
      });
    }
  };
  if (db === prisma) await prisma.$transaction(perform);
  else await perform(db);
}

/** Verification may link mutually named people, but only within the same entry. */
export async function onAthleteVerified(userId: string, rawEmail: string, onlySeriesId?: string) {
  const email = normalizeEmail(rawEmail);
  const entries = await prisma.seriesParticipant.findMany({
    where: { userId, archivedAt: null, partnerUserId: null, ...(onlySeriesId ? { seriesId: onlySeriesId } : {}) },
  });
  for (const own of entries) {
    const named = own.partnerEmail ? normalizeEmail(own.partnerEmail) : null;
    const candidates = await prisma.seriesParticipant.findMany({
      where: { seriesId: own.seriesId, archivedAt: null, partnerUserId: null, partnerEmail: email,
        userId: { not: userId }, user: { archivedAt: null, status: "active", emailVerified: { not: null } } },
      include: { user: { select: { email: true } } }, orderBy: { createdAt: "asc" },
    });
    // An explicit mutual choice avoids claiming an unrelated person merely by knowing their email.
    const match = named ? candidates.find(p => normalizeEmail(p.user.email) === named) : null;
    if (match) await linkPair(userId, match.userId, own.seriesId);
  }
}
