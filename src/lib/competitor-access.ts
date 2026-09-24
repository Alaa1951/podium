import "server-only";

import { prisma } from "@/lib/prisma";
import { isCompeting } from "@/lib/team-status";
import { createOtpChallenge } from "@/lib/otp";
import { normalizeEmail } from "@/lib/security";

// ─────────────────────────────────────────────────────────────────────────────
// LETTING A COMPETITOR IN.
//
// A registered competitor has no password and never will: they gave an email
// when they entered, and that is the whole credential. They ask for a code, it
// arrives, and they are in — for a day, which is how long a competition and the
// evening of arguing about the results actually lasts.
//
// The account is created on the way through rather than up front. Registering
// 216 people would otherwise mean 216 dormant logins, most of which are never
// used, and every one of them a thing that can be attacked.
// ─────────────────────────────────────────────────────────────────────────────

/** How long a competitor stays signed in, in hours. */
export const COMPETITOR_SESSION_HOURS = 24;

/**
 * The competitor rows this email belongs to, newest competition first.
 *
 * Matching on the registration rather than on an account is the point: the
 * person has never signed in, so there is nothing else to match against.
 */
export async function findRegistrations(rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  if (!email) return [];

  return prisma.competitor.findMany({
    where: { email },
    orderBy: { team: { series: { competitionDate: "desc" } } },
    select: {
      id: true,
      fullName: true,
      userId: true,
      team: {
        select: {
          id: true,
          name: true,
          paymentStatus: true,
          waitlistedAt: true,
          series: { select: { id: true, name: true, slug: true, status: true, isTraining: true } },
        },
      },
    },
  });
}

/**
 * The account this competitor signs in as, created the first time they ask.
 *
 * Every registration carrying the same email is linked to it, so a competitor
 * who has entered three PODIUMs sees all three under one login rather than
 * needing a different way in for each.
 */
export async function accountForCompetitor(rawEmail: string, fullName: string) {
  const email = normalizeEmail(rawEmail);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.status === "disabled" || existing.archivedAt) return null;
    await linkRegistrations(existing.id, email);
    // A paid entry is all the approval an athlete needs: someone who signed
    // up and then registered and paid is not left waiting on a queue.
    if (existing.role === "competitor" && existing.approvalStatus !== "approved") {
      return prisma.user.update({
        where: { id: existing.id },
        data: { approvalStatus: "approved", approvedAt: new Date(), rejectionReason: null },
      });
    }
    return existing;
  }

  // Active immediately: the emailed code IS the verification, so there is
  // nothing further for an invitation to prove.
  const created = await prisma.user.create({
    data: {
      email,
      name: fullName,
      role: "competitor",
      status: "active",
      emailVerified: new Date(),
    },
  });

  await linkRegistrations(created.id, email);
  return created;
}

/** Point every registration with this email at the account. */
async function linkRegistrations(userId: string, email: string) {
  await prisma.competitor.updateMany({
    where: { email, userId: null },
    data: { userId },
  });
  const seats = await prisma.competitor.findMany({
    where: { userId, team: { archivedAt: null, series: { archivedAt: null } } }, include: { team: true },
  });
  for (const seat of seats) {
    await prisma.seriesParticipant.upsert({
      where: { seriesId_userId: { seriesId: seat.team.seriesId, userId } }, update: {},
      create: { seriesId: seat.team.seriesId, userId, signedUpAt: seat.team.createdAt,
        division: seat.team.division, category: seat.team.category, shirtSize: seat.shirtSize,
        bftMember: seat.bftMember, lookingForPartner: false, teamName: seat.team.name },
    });
  }
}

export type CodeRequest =
  | { ok: true; code: string; name: string }
  /** No registration, unpaid, or a disabled account — all silent to the caller. */
  | { ok: false };

/**
 * Issue a sign-in code for a registered competitor.
 *
 * The caller is told nothing about why it failed. Whether an address competed
 * in PODIUM is not something a stranger gets to test, so the screen says the
 * same thing either way.
 */
export async function issueCompetitorCode(rawEmail: string): Promise<CodeRequest> {
  const registrations = await findRegistrations(rawEmail);

  // Only a COMPETING entry is a competitor — paid, and holding a place. An
  // unpaid registration has not been confirmed by anybody yet, and one on the
  // waiting list has not been let in, however much money has arrived against
  // it: paying is not how somebody joins a competition that is full.
  //
  // Either way an athlete who signed up has an account of their own, approved
  // or waiting, so they are not locked out — they just do not come in through
  // this door, which is the one that carries automatic approval with it.
  const paid = registrations.filter((one) => !one.team.series.isTraining && isCompeting(one.team));
  if (paid.length === 0) return issueSignedUpAthleteCode(rawEmail);

  const account = await accountForCompetitor(rawEmail, paid[0].fullName);
  if (!account) return { ok: false };

  const { code } = await createOtpChallenge({ userId: account.id, purpose: "login" });
  return { ok: true, code, name: paid[0].fullName };
}

/** A code for an athlete who signed up themselves, whatever their approval. */
async function issueSignedUpAthleteCode(rawEmail: string): Promise<CodeRequest> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false };
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, role: true, status: true, signupType: true },
  });
  if (!user || user.role !== "competitor" || !user.signupType || user.status === "disabled") {
    return { ok: false };
  }
  const { code } = await createOtpChallenge({ userId: user.id, purpose: "login" });
  return { ok: true, code, name: user.name ?? email };
}
