import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { PROOF_TX } from "@/lib/auth-proof";
import { reconcileDerivedLinks } from "@/lib/membership-sync";
import { normalizeEmail } from "@/lib/security";
import { isCompeting } from "@/lib/team-status";

// ─────────────────────────────────────────────────────────────────────────────
// LINKING AN ACCOUNT TO ITS SEATS — only on a proven address.
//
// A seat (Competitor row) carries the email the athlete registered with; an
// account carries the email they sign in with. They are the same person when
// the account has PROVEN that address (auth-proof.ts) and it is the address
// on the seat. Nothing else counts: not a password sign-in on its own, not a
// name, not "the email looks the same".
//
// ONE UNIT OF WORK. Claiming the seat, creating the participant row,
// bringing both members' partner links in step and approving the account
// commit together or not at all, whichever door called: a failure halfway
// leaves the seat unclaimed, so the next sign-in or /me simply tries again.
// It is always its OWN transaction — after a code or link has been accepted
// and committed, after a password sign-in, on /me — never nested inside
// another (Prisma 7 turns a transaction inside a transaction into a
// savepoint it tracks itself; it is kept out of that). The proof it relies
// on is re-read under the account lock, so an address changed in between
// links nothing, and a failed link never costs the sign-in or the proof.
//
// THE ADDRESS PROVES THE PAYER. In one competition, an email claims:
//
//   · its one seat, when it sits on one seat — the ordinary case, registrant
//     or partner alike;
//   · the REGISTRANT'S seat (position 1) only, when it sits on both seats of
//     ONE team. The CRM form puts the payer's address on the partner's seat
//     too; the payer is the person who proved it, and the partner's seat
//     waits for the partner's own address. Refusing both, as this once did,
//     left the paying athlete signed in and looking at "No entry found";
//   · nothing, when it sits on seats of MORE THAN ONE team. A coach who
//     entered several teams under their own address must not become all of
//     them, and which one is theirs is not something an address can say.
//
// A seat with no email never takes part: it shares no address, so it can
// neither claim nor block. The code door (competitor-access.ts) asks the
// same question, so an address that links here gets a code there.
//
// SERIALISED PER COMPETITION. Before claiming, the competition row is locked
// — the lock every team writer takes (team-create, swap, partner requests) —
// so two partners signing in for the first time at the same moment are
// handled one after the other, and the second sees the first's seat.
//
// Repeated calls with nothing to claim take no lock and write nothing
// (plan §3.3) — a partner's seat left unclaimed on purpose included.
//
// No "server-only" import on purpose (the integration harness calls this).
// ─────────────────────────────────────────────────────────────────────────────

export type LinkOutcome = {
  /** Seats claimed by this call (0 on an ordinary sign-in). */
  linked: number;
  /** The account was pending and a paid entry approved it. */
  approved: boolean;
  /** Why nothing was linked, for logs and the report script. */
  skipped: "not_competitor" | "not_active" | "rejected" | "unproven" | "failed" | null;
};

const none = (skipped: LinkOutcome["skipped"]): LinkOutcome => ({ linked: 0, approved: false, skipped });

/**
 * The seats an address may claim, competition by competition (the rule above):
 * its only seat; the registrant's seat when it sits on both seats of one team;
 * nothing when it spans teams. In the order given.
 */
export function payerSeatsToClaim<T extends { id: string; position: number; team: { id: string; seriesId: string } }>(rows: T[]): T[] {
  const bySeries = new Map<string, T[]>();
  for (const row of rows) bySeries.set(row.team.seriesId, [...(bySeries.get(row.team.seriesId) ?? []), row]);
  const chosen = new Set<string>();
  for (const seats of bySeries.values()) {
    if (new Set(seats.map((seat) => seat.team.id)).size !== 1) continue;
    const seat = seats.length === 1 ? seats[0] : seats.find((one) => one.position === 1);
    if (seat) chosen.add(seat.id);
  }
  return rows.filter((row) => chosen.has(row.id));
}

/** The switch that turns this off without touching the proof rule (plan §15). */
export function seatLinkingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ATHLETE_SEAT_LINKING !== "off";
}

const LIVE_TEAM = { archivedAt: null, series: { archivedAt: null } } as const;

function logFailure(userId: string, error: unknown) {
  console.error("[LINK-SEATS]", userId, error instanceof Error ? error.message : error);
}

export async function linkSeatsForUser(db: PrismaClient, userId: string): Promise<LinkOutcome> {
  if (!seatLinkingEnabled()) return none(null);

  // The ordinary sign-in: nothing this address may claim is unclaimed —
  // nothing to do, no transaction, no lock. A partner's seat under the
  // payer's address stays unclaimed for good, so it is the claimable seats
  // that are counted, not the open ones. (Read-only; the claim re-checks it.)
  const account = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!account) return none("not_competitor");
  const mine = await db.competitor.findMany({
    where: { email: normalizeEmail(account.email), team: LIVE_TEAM },
    select: { id: true, userId: true, position: true, team: { select: { id: true, seriesId: true } } },
  });
  if (!payerSeatsToClaim(mine).some((seat) => !seat.userId)) return none(null);

  try {
    return await db.$transaction((tx) => claimSeats(tx, userId), PROOF_TX);
  } catch (error) {
    // Rolled back whole: the seat is still unclaimed and the next visit
    // tries again.
    logFailure(userId, error);
    return none("failed");
  }
}

type LockedAccount = {
  email: string;
  role: string;
  status: string;
  archivedAt: Date | null;
  approvalStatus: string;
  verifiedEmail: string | null;
};

async function claimSeats(tx: Prisma.TransactionClient, userId: string): Promise<LinkOutcome> {
  // The account as committed now, locked for the rest of the transaction.
  const [user] = await tx.$queryRaw<LockedAccount[]>`SELECT email, role, status, archivedAt, approvalStatus, verifiedEmail FROM User WHERE id = ${userId} FOR UPDATE`;
  if (!user || user.role !== "competitor") return none("not_competitor");
  if (user.status !== "active" || user.archivedAt) return none("not_active");
  if (user.approvalStatus === "rejected") return none("rejected");
  const email = normalizeEmail(user.email);
  if (!user.verifiedEmail || normalizeEmail(user.verifiedEmail) !== email) return none("unproven");

  const open = await tx.competitor.findMany({
    where: { email, userId: null, team: LIVE_TEAM },
    select: { team: { select: { seriesId: true } } },
  });
  if (open.length === 0) return none(null);

  // One competition at a time, always in the same order.
  const seriesIds = [...new Set(open.map((seat) => seat.team.seriesId))].sort();
  for (const seriesId of seriesIds) {
    await tx.$queryRaw`SELECT id FROM Series WHERE id = ${seriesId} FOR UPDATE`;
  }

  // Read again under the locks: the roster as it is now.
  const seats = await tx.competitor.findMany({
    where: { email, team: { ...LIVE_TEAM, seriesId: { in: seriesIds } } },
    select: {
      id: true, userId: true, position: true, shirtSize: true, bftMember: true,
      team: {
        select: {
          id: true, seriesId: true, name: true, createdAt: true, division: true, category: true,
          paymentStatus: true, waitlistedAt: true, registrantEmail: true, registrantUserId: true,
          series: { select: { isTraining: true } },
          competitors: { select: { id: true } },
        },
      },
    },
  });

  let linked = 0;
  let paidEntry = false;
  for (const seat of payerSeatsToClaim(seats)) {
    if (seat.userId) continue; // already somebody's — ours or not, we never take it
    const claimed = await tx.competitor.updateMany({ where: { id: seat.id, email, userId: null }, data: { userId } });
    if (claimed.count !== 1) continue;
    linked += 1;
    const complete = seat.team.competitors.length === 2;
    // A participant row is created if missing and never altered if present:
    // linking is not a partnership choice. A solo entry is still looking.
    await tx.seriesParticipant.upsert({
      where: { seriesId_userId: { seriesId: seat.team.seriesId, userId } },
      update: {},
      create: {
        seriesId: seat.team.seriesId, userId, signedUpAt: seat.team.createdAt,
        division: seat.team.division, category: seat.team.category, shirtSize: seat.shirtSize,
        bftMember: seat.bftMember, lookingForPartner: !complete, teamName: complete ? seat.team.name : null,
      },
    });
    // The person who registered the team has just claimed their seat: the
    // team now knows their account too (plan §3.3). Nothing else changes.
    if (!seat.team.registrantUserId && seat.team.registrantEmail && normalizeEmail(seat.team.registrantEmail) === email) {
      await tx.team.updateMany({ where: { id: seat.team.id, registrantUserId: null }, data: { registrantUserId: userId } });
    }
    await reconcileDerivedLinks(tx, seat.team.id);
    // A training run is a rehearsal: its seat shows, it never approves.
    if (!seat.team.series.isTraining && isCompeting(seat.team)) paidEntry = true;
  }

  // A paid entry is all the approval an athlete needs — once the address is
  // proven, and never for an account BFT MENA rejected. Nothing else here
  // approves: an unpaid, waiting-list or training seat is linked and shown
  // with its true state, and the account keeps waiting.
  let approved = false;
  if (linked > 0 && paidEntry && user.approvalStatus === "pending") {
    await tx.user.update({
      where: { id: userId },
      data: { approvalStatus: "approved", approvedAt: new Date(), rejectionReason: null },
    });
    approved = true;
  }
  return { linked, approved, skipped: null };
}
