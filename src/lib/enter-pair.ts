import "server-only";

import { prisma } from "@/lib/prisma";
import { alreadyEntered } from "@/lib/one-entry";
import { normalizeName } from "@/lib/scoring";
import { entryPlace } from "@/lib/visibility";

// ─────────────────────────────────────────────────────────────────────────────
// THE BRIDGE THAT WAS MISSING.
//
// Signing up gave somebody an ACCOUNT. Being approved gave that account its
// role. Neither one ever put them in a COMPETITION — the only thing tying a
// person to one was Competitor → Team → Series, and the only way to create that
// was a studio pressing "enter as a team". So an athlete could sign up, choose
// PODIUM 4, be approved, find a partner, and still be in nothing at all, with
// no screen telling them why.
//
// This closes it. It is called from BOTH ends of the two things that have to be
// true — approval (`approvals.ts`) and partnering up (`partner-requests.ts`) —
// so whichever happens LAST is what enters them. It does nothing at all unless
// every condition holds, which is what makes it safe to call from both.
//
// WHAT IT INSISTS ON, and why each one:
//   • both approved, active athletes           — an entry is a commitment
//   • linked to each other                     — a team is two people
//   • BOTH chose the SAME competition          — see below
//   • same level, and a category their genders allow
//   • neither already entered in it
//
// BOTH must have chosen it. Entering somebody into a competition commits them
// to a date and a fee; doing that to a person who never asked for it is not a
// convenience. A pair where only one chose is left for staff, and they are
// already visible on the partner-watch screen with exactly that shape.
//
// WHAT IT DOES NOT DO: take money, place them in a wave, or approve anybody.
// The entry is created unpaid, like every other, and the existing gates decide
// the rest.
// ─────────────────────────────────────────────────────────────────────────────

export type EnterPairOutcome =
  | { entered: true; teamId: string; teamNumber: number; waitlisted: boolean }
  | { entered: false; reason: EnterPairReason };

export type EnterPairReason =
  | "NO_COMPETITION"
  | "NO_PARTNER"
  | "PARTNER_CHOSE_ANOTHER"
  | "NOT_APPROVED"
  | "INCOMPLETE_PROFILE"
  | "MIXED_LEVELS"
  | "CATEGORY_MISMATCH"
  | "ALREADY_ENTERED"
  | "COMPETITION_CLOSED";

const athleteSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  studioId: true,
  signupAt: true,
  approvalStatus: true,
  status: true,
  archivedAt: true,
  role: true,
  requestedSeriesId: true,
  athleteProfile: {
    select: {
      partnerUserId: true,
      division: true,
      category: true,
      sex: true,
      dateOfBirth: true,
      shirtSize: true,
      bftMember: true,
      teamName: true,
    },
  },
} as const;

type Athlete = NonNullable<Awaited<ReturnType<typeof loadAthlete>>>;

function loadAthlete(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: athleteSelect });
}

/** An approved, active athlete account — the only kind that may be entered. */
function usable(athlete: Athlete | null): athlete is Athlete {
  return Boolean(
    athlete &&
      athlete.role === "competitor" &&
      athlete.approvalStatus === "approved" &&
      athlete.status !== "disabled" &&
      !athlete.archivedAt
  );
}

/**
 * Enter this athlete and their partner into the competition they both chose,
 * if everything needed is true. Safe to call whenever anything changes; it is
 * a no-op in every case but the complete one.
 *
 * Never throws for a condition that is simply not met — the caller is usually
 * a decision that has already been taken and must stand either way.
 */
export async function enterPairIfReady(userId: string): Promise<EnterPairOutcome> {
  const me = await loadAthlete(userId);
  if (!usable(me)) return { entered: false, reason: "NOT_APPROVED" };

  const seriesId = me.requestedSeriesId;
  if (!seriesId) return { entered: false, reason: "NO_COMPETITION" };

  const partnerId = me.athleteProfile?.partnerUserId;
  if (!partnerId) return { entered: false, reason: "NO_PARTNER" };

  const partner = await loadAthlete(partnerId);
  if (!usable(partner)) return { entered: false, reason: "NOT_APPROVED" };
  // The pair must want the same thing. One of them choosing is not consent
  // from the other, whichever way round it happens to be.
  if (partner.requestedSeriesId !== seriesId) {
    return { entered: false, reason: "PARTNER_CHOSE_ANOTHER" };
  }
  // And they must actually be each other's — a one-sided link is not a pair.
  if (partner.athleteProfile?.partnerUserId !== me.id) {
    return { entered: false, reason: "NO_PARTNER" };
  }

  const series = await prisma.series.findFirst({
    where: { id: seriesId, archivedAt: null, isActive: true, status: { not: "final" } },
    select: { id: true, name: true, registrationClosesAt: true },
  });
  if (!series) return { entered: false, reason: "COMPETITION_CLOSED" };

  // ── The bracket, decided from the profiles and never from a form ──────────
  // It picks the board bracket AND the prescribed loads (LoadStandard is keyed
  // on [division, sex]), so it is derived here from what the two athletes
  // actually are.
  const mine = me.athleteProfile;
  const theirs = partner.athleteProfile;
  if (!mine?.division || !mine.category || !theirs?.division || !theirs.category) {
    return { entered: false, reason: "INCOMPLETE_PROFILE" };
  }
  if (mine.division !== theirs.division) return { entered: false, reason: "MIXED_LEVELS" };
  if (mine.category !== theirs.category) return { entered: false, reason: "CATEGORY_MISMATCH" };

  const sexes = [mine.sex, theirs.sex].filter(Boolean);
  const impossible =
    (mine.category === "Womens" && sexes.some((sex) => sex === "m")) ||
    (mine.category === "Mens" && sexes.some((sex) => sex === "f"));
  if (impossible) return { entered: false, reason: "CATEGORY_MISMATCH" };

  // Nobody enters the same competition twice — including through a studio that
  // already entered them by hand.
  const already = await alreadyEntered({
    seriesId: series.id,
    userIds: [me.id, partner.id],
    emails: [me.email, partner.email],
  });
  if (already) return { entered: false, reason: "ALREADY_ENTERED" };

  // ── A place in the field, or the waiting list ─────────────────────────────
  // The LATER of the two sign-ups decides. A pair's claim on a place is only
  // as good as its second member: letting the early one carry a late partner
  // in would make "sign up before the deadline" mean nothing, because anybody
  // could be added afterwards.
  const signedUpAt = [me.signupAt, partner.signupAt].reduce<Date | null>((latest, one) => {
    if (!one) return latest;
    return !latest || one > latest ? one : latest;
  }, null);
  const place = entryPlace({ signedUpAt, registrationClosesAt: series.registrationClosesAt });
  const waitlisted = place === "waiting_list";

  const ordered = [me, partner];
  const name = (mine.teamName || theirs.teamName || me.name || me.email).toUpperCase();

  // The next free number is read and then written, and `@@unique([seriesId,
  // number])` is what makes that safe: if approval and a partner acceptance
  // ever fire at the same instant, both compute the same number and the second
  // insert is rejected rather than creating a second team for one pair.
  const highest = await prisma.team.findFirst({
    where: { seriesId: series.id },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const number = Math.max(100, highest?.number ?? 100) + 1;

  try {
    const team = await prisma.team.create({
      data: {
        seriesId: series.id,
        number,
        name,
        category: mine.category,
        division: mine.division,
        studioId: me.studioId ?? partner.studioId ?? null,
        paymentStatus: "pending",
        source: "signup",
        waitlistedAt: waitlisted ? new Date() : null,
        competitors: {
          create: ordered.map((athlete, index) => ({
            position: index + 1,
            fullName: athlete.name ?? athlete.email,
            normalizedName: normalizeName(athlete.name ?? athlete.email),
            email: athlete.email.toLowerCase(),
            phone: athlete.phone,
            dateOfBirth: athlete.athleteProfile?.dateOfBirth ?? null,
            shirtSize: athlete.athleteProfile?.shirtSize ?? null,
            bftMember: athlete.athleteProfile?.bftMember ?? false,
            studioId: athlete.studioId,
            userId: athlete.id,
          })),
        },
      },
      select: { id: true, number: true },
    });
    return { entered: true, teamId: team.id, teamNumber: team.number, waitlisted };
  } catch (error) {
    // The unique collision described above, or a number taken in between by a
    // studio registering somebody. Either way the pair is not double-entered.
    const code = (error as { code?: string })?.code;
    if (code === "P2002") return { entered: false, reason: "ALREADY_ENTERED" };
    throw error;
  }
}
