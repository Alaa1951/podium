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

/** Link two athletes as partners, both ways. */
export async function linkPair(a: string, b: string) {
  const now = new Date();
  const [first, second] = await Promise.all([
    prisma.user.findUnique({ where: { id: a }, select: { name: true, email: true, phone: true } }),
    prisma.user.findUnique({ where: { id: b }, select: { name: true, email: true, phone: true } }),
  ]);
  if (!first || !second) return;
  await prisma.$transaction([
    prisma.athleteProfile.update({
      where: { userId: a },
      data: {
        partnerUserId: b,
        partnerLinkedAt: now,
        lookingForPartner: false,
        partnerName: second.name,
        partnerEmail: second.email,
        partnerPhone: second.phone,
      },
    }),
    prisma.athleteProfile.update({
      where: { userId: b },
      data: {
        partnerUserId: a,
        partnerLinkedAt: now,
        lookingForPartner: false,
        partnerName: first.name,
        partnerEmail: first.email,
        partnerPhone: first.phone,
      },
    }),
  ]);
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
