import "server-only";

import { prisma } from "@/lib/prisma";
import { unambiguousSeats } from "@/lib/link-seats";
import { isCompeting } from "@/lib/team-status";
import { createOtpChallenge } from "@/lib/otp";
import { normalizeEmail } from "@/lib/security";

// ─────────────────────────────────────────────────────────────────────────────
// LETTING A COMPETITOR IN.
//
// A registered competitor gave an email when they entered, and that is their
// credential: they ask for a code, it arrives, and they are in. Setting a
// password is theirs to choose later (Account), never required.
//
// ASKING FOR A CODE PROVES NOTHING. Anyone can type an address into the form.
// So this file only decides whether a code goes out, and — for a competing
// entry with no account yet — mints the row it will be checked against, as
// `invited`, unverified, linked to no seat. Linking, activation and approval all happen when the code is TYPED
// (auth-password.ts › competitor, through auth-proof.ts and link-seats.ts),
// under lock, against the address the code was sent to.
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
    where: { email, team: { archivedAt: null, series: { archivedAt: null } } },
    orderBy: { team: { series: { competitionDate: "desc" } } },
    select: {
      id: true,
      fullName: true,
      userId: true,
      team: {
        select: {
          id: true,
          seriesId: true,
          name: true,
          paymentStatus: true,
          waitlistedAt: true,
          series: { select: { id: true, name: true, slug: true, status: true, isTraining: true } },
        },
      },
    },
  });
}

export type CodeRequest =
  | { ok: true; code: string; name: string }
  /**
   * No code. `signup`: the address is on a registration but has no account
   * and no entry that opens this door by itself — the owner is told BY EMAIL
   * to create their account with Sign up (the screen says the same thing
   * either way).
   */
  | { ok: false; signup?: true };

/**
 * Issue a sign-in code.
 *
 * The caller is told nothing about why it failed. Whether an address competed
 * in PODIUM is not something a stranger gets to test, so the screen says the
 * same thing either way.
 */
export async function issueCompetitorCode(rawEmail: string): Promise<CodeRequest> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false };

  // ANY ATHLETE ACCOUNT gets a code: it is their way in whether or not they
  // ever set a password, whatever their approval or entry. A code grants
  // nothing by itself — approval and seats follow their own rules once the
  // address is proven. Staff accounts never come in this way.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, status: true, archivedAt: true },
  });
  if (existing) {
    if (existing.role !== "competitor" || existing.status === "disabled" || existing.archivedAt) return { ok: false };
    const { code } = await createOtpChallenge({ userId: existing.id, purpose: "login", sentTo: existing.email });
    return { ok: true, code, name: existing.name ?? email };
  }

  // NO ACCOUNT YET. Only a COMPETING entry (paid, holding a place, not a
  // training run) mints one here, as `invited` with nothing proven. Whether
  // any seat should do so is an open product decision (D4); until it is
  // made, the holder of another seat is pointed at Sign up, which creates
  // their account waiting for approval and links the seat once the address
  // is proven — visible with its true state, approving nothing.
  const registrations = await findRegistrations(email);
  const paid = unambiguousSeats(registrations).filter((one) => !one.team.series.isTraining && isCompeting(one.team));
  if (paid.length === 0) return registrations.length > 0 ? { ok: false, signup: true } : { ok: false };

  const account = await prisma.user.create({
    data: { email, name: paid[0].fullName, role: "competitor", status: "invited" },
  });
  const { code } = await createOtpChallenge({ userId: account.id, purpose: "login", sentTo: account.email });
  return { ok: true, code, name: paid[0].fullName };
}
