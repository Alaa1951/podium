import "server-only";

import { sendPartnerInviteEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { getBaseUrl, normalizeEmail } from "@/lib/security";

// ─────────────────────────────────────────────────────────────────────────────
// PARTNERS.
//
// At sign-up an athlete either names a partner or says they are looking for
// one. Linking happens when an address is PROVEN — the first time its owner
// types the emailed code — never on an unverified form, so a stranger cannot
// attach themselves to somebody by typing their email.
//
//   • Anyone who named this address as their partner is linked to it — but
//     only if this athlete named them back, or named nobody.
//   • Two athletes are linked only when each named the other (or one named
//     the other and the other named nobody yet). Somebody named who has no
//     account is invited; somebody named who has one is told by email.
// ─────────────────────────────────────────────────────────────────────────────

/** The slice of the client both `prisma` and a `$transaction` callback share. */
type Db = Pick<typeof prisma, "user" | "athleteProfile">;

const personSelect = {
  name: true,
  email: true,
  phone: true,
  athleteProfile: {
    select: { dateOfBirth: true, sex: true, shirtSize: true, bftMember: true },
  },
} as const;

/**
 * Link two athletes as partners, both ways.
 *
 * Each side's profile keeps a copy of the other's details — the name, address
 * and phone they will need to reach each other, and the date of birth, gender
 * and shirt size the studio would otherwise have to retype at registration.
 * Not `teamName`: what a pair competes as is their own choice, made when they
 * are entered, and neither of them has agreed to one yet.
 *
 * Pass `db` to run inside a caller's transaction — accepting a partner request
 * claims both profiles and links them in one go, and a gap between those two
 * would be a gap somebody else could be linked through.
 */
export async function linkPair(a: string, b: string, db: Db = prisma) {
  const now = new Date();
  const [first, second] = await Promise.all([
    db.user.findUnique({ where: { id: a }, select: personSelect }),
    db.user.findUnique({ where: { id: b }, select: personSelect }),
  ]);
  if (!first || !second) return;

  const sideOf = (them: typeof first, theirId: string) => ({
    partnerUserId: theirId,
    partnerLinkedAt: now,
    lookingForPartner: false,
    partnerName: them.name,
    partnerEmail: them.email,
    partnerPhone: them.phone,
    partnerDateOfBirth: them.athleteProfile?.dateOfBirth ?? null,
    partnerSex: them.athleteProfile?.sex ?? null,
    partnerShirtSize: them.athleteProfile?.shirtSize ?? null,
    partnerBftMember: them.athleteProfile?.bftMember ?? false,
  });

  const writes = [
    { where: { userId: a }, data: sideOf(second, b) },
    { where: { userId: b }, data: sideOf(first, a) },
  ];

  // Half a link is worse than none, so the two writes are always atomic. When
  // a caller hands in its own transaction they already are; on our own client
  // they need wrapping, and nesting one inside the other is not allowed.
  if (db === prisma) {
    await prisma.$transaction(writes.map((write) => prisma.athleteProfile.update(write)));
    return;
  }
  for (const write of writes) await db.athleteProfile.update(write);
}

/**
 * Link this athlete to their partner if both sides agree, or tell the partner.
 * Called when an athlete's address is first verified, and whenever they
 * change who their partner is. `rawEmail` must be the athlete's own, proven.
 */
export async function onAthleteVerified(userId: string, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  const own = await prisma.athleteProfile.findUnique({
    where: { userId },
    select: { partnerEmail: true, partnerUserId: true, user: { select: { name: true } } },
  });
  if (!own || own.partnerUserId) return;
  const named = own.partnerEmail ? normalizeEmail(own.partnerEmail) : null;

  // 1. Someone who named this address, still unlinked — if this athlete named
  //    them back, or has not named anyone.
  const namedMe = await prisma.athleteProfile.findMany({
    where: { partnerEmail: email, partnerUserId: null, NOT: { userId } },
    orderBy: { createdAt: "asc" },
    select: { userId: true, user: { select: { email: true } } },
  });
  const match = named
    ? namedMe.find((profile) => normalizeEmail(profile.user.email) === named)
    : namedMe[0];
  if (match) {
    await linkPair(userId, match.userId);
    return;
  }

  // 2. The partner this athlete named, who has not named them (yet).
  if (!named || named === email) return;
  const partner = await prisma.user.findUnique({
    where: { email: named },
    select: { id: true, athleteProfile: { select: { partnerUserId: true, partnerEmail: true } } },
  });
  if (partner?.athleteProfile?.partnerUserId) return; // already paired with someone else
  if (partner && partner.athleteProfile && !partner.athleteProfile.partnerEmail) {
    // They are looking for a partner: this athlete naming them is the match.
    await linkPair(userId, partner.id);
    return;
  }
  try {
    await sendPartnerInviteEmail({
      email: named,
      fromName: own.user.name ?? email,
      hasAccount: Boolean(partner),
      url: partner
        ? `${getBaseUrl()}/me`
        : `${getBaseUrl()}/signup?type=athlete&email=${encodeURIComponent(named)}`,
    });
  } catch {
    // An invitation that did not go out must not undo the sign-up.
  }
}
