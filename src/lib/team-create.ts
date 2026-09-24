import "server-only";

import { prisma as defaultPrisma } from "@/lib/prisma";
import { ensureParticipation } from "@/lib/participation";
import { linkPair } from "@/lib/partners";
import { findEntryInSeries } from "@/lib/one-entry";
import type { Prisma } from "@/generated/prisma/client";
import { normalizeName } from "@/lib/scoring";

// ─────────────────────────────────────────────────────────────────────────────
// CREATING A TEAM AND ITS SEATS — one path, used by every caller.
//
// There were two before this: the by-hand registration form, and whatever the
// CRM integration was going to grow. Two paths that create the same row drift,
// and the drift is invisible until a report disagrees with itself — the manual
// path already omitted `shirtSize` and `bftMember` while the columns sat there
// waiting. So the writing lives here and the callers supply the differences.
//
// WHAT THIS DOES NOT DO: no permission check, no audit, no revalidation. Those
// belong to the caller, because they differ completely — a server action has
// an actor and a session, and a background poller has neither. Putting them
// here would mean inventing an actor for the poller, and an audit trail that
// names a person who was asleep is worse than none.
// ─────────────────────────────────────────────────────────────────────────────

type Db = typeof defaultPrisma;
type TeamDb = Pick<Prisma.TransactionClient, "team">;

export type NewSeat = {
  userId?: string | null;
  /** 1 = the registering competitor, 2 = their partner. */
  position: number;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: Date | null;
  shirtSize?: "XS" | "S" | "M" | "L" | "XL" | "XXL" | null;
  bftMember?: boolean;
  studioId?: string | null;
};

export type NewTeam = {
  seriesId: string;
  name: string;
  category: "Mens" | "Womens" | "Mixed";
  division: "Rookie" | "Open" | "Pro";
  studioId?: string | null;
  paymentStatus?: "pending" | "paid" | "refunded";
  source?: "ghl" | "manual" | "seed" | "signup";
  paidAt?: Date | null;
  confirmedById?: string | null;
  amountMinor?: number | null;
  currency?: string;
  billingNumber?: string | null;
  paymentNote?: string | null;
  /**
   * Entered after registration closed, holding no place yet.
   *
   * It had no field here at all, which meant a CRM registration could never
   * land on the waiting list however late it arrived — the deadline simply
   * did not apply to the one route most entries come through.
   */
  waitlistedAt?: Date | null;
  /** The CRM record this came from. Unique per competition. */
  externalId?: string | null;
  /** That record exactly as it arrived, so a dispute can be read back. */
  rawPayload?: unknown;
  seats: NewSeat[];
};

export type CreateOutcome =
  | { ok: true; id: string; number: number; name: string }
  | { ok: false; error: "ALREADY_ENTERED" | "NUMBER_RACE" | "HAS_OTHER_PARTNER" };

/**
 * The next free team number for a competition.
 *
 * Called while the writer holds the competition row lock. The unique index
 * remains the final constraint for legacy and external writers.
 *
 * Numbers start at 101 so a team number is never mistaken for a station.
 */
export async function nextTeamNumber(db: TeamDb, seriesId: string): Promise<number> {
  const highest = await db.team.findFirst({
    where: { seriesId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return Math.max(100, highest?.number ?? 100) + 1;
}

/** Which unique index a P2002 was about. Prisma reports it differently per driver. */
function violated(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const code = (error as { code?: string }).code;
  if (code !== "P2002") return "";
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) ? target.join(",") : String(target ?? "");
}

const ATTEMPTS = 5;

/**
 * Write the team and both seats.
 *
 * TWO UNIQUE INDEXES CAN FIRE HERE AND THEY MEAN OPPOSITE THINGS:
 *
 *   [seriesId, number]     — somebody else took the number between the read
 *                            and the write. Transient; pick another and retry.
 *   [seriesId, externalId] — this CRM record is already a team in this
 *                            competition. Not an error and NOT retryable:
 *                            retrying would spin five times and then report a
 *                            race that never happened. It is the sync's own
 *                            idempotency, and the answer is to do nothing.
 *
 * Telling them apart is the reason this function exists rather than a bare
 * `prisma.team.create` at each call site.
 */
export async function createTeam(db: Db, input: NewTeam): Promise<CreateOutcome> {
  const ids = input.seats.map(s => s.userId).filter(Boolean);
  const emails = input.seats.map(s => s.email?.trim().toLowerCase()).filter(Boolean);
  if (new Set(ids).size !== ids.length || new Set(emails).size !== emails.length) return { ok: false, error: "ALREADY_ENTERED" };
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const team = await db.$transaction(async (tx) => {
        const series = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM Series WHERE id = ${input.seriesId} AND archivedAt IS NULL FOR UPDATE`;
        if (!series.length) throw new Error("COMPETITION_NOT_FOUND");
        const duplicate = await findEntryInSeries({ seriesId: input.seriesId, userIds: input.seats.map(s => s.userId), emails: input.seats.map(s => s.email) }, tx);
        if (duplicate) throw new Error("ALREADY_ENTERED");
        for (const seat of input.seats) {
          if (!seat.userId) continue;
          await ensureParticipation(seat.userId, input.seriesId, tx);
          await tx.seriesParticipant.update({ where: { seriesId_userId: { seriesId: input.seriesId, userId: seat.userId } }, data: { archivedAt: null, division: input.division, category: input.category, teamName: input.name, lookingForPartner: false } });
        }
        if (input.seats.length === 2 && ids.length === 2) await linkPair(ids[0]!, ids[1]!, input.seriesId, tx);
        return tx.team.create({
        data: {
          seriesId: input.seriesId,
          number: await nextTeamNumber(tx, input.seriesId),
          name: input.name,
          category: input.category,
          division: input.division,
          studioId: input.studioId ?? null,
          paymentStatus: input.paymentStatus ?? "pending",
          source: input.source ?? "manual",
          waitlistedAt: input.waitlistedAt ?? null,
          paidAt: input.paidAt ?? null,
          confirmedById: input.confirmedById ?? null,
          amountMinor: input.amountMinor ?? null,
          ...(input.currency ? { currency: input.currency } : {}),
          billingNumber: input.billingNumber ?? null,
          paymentNote: input.paymentNote ?? null,
          externalId: input.externalId ?? null,
          ...(input.rawPayload === undefined
            ? {}
            : { rawPayload: input.rawPayload as never }),
          competitors: {
            create: input.seats.map((seat) => ({
              position: seat.position,
              userId: seat.userId ?? null,
              fullName: seat.fullName,
              normalizedName: normalizeName(seat.fullName),
              email: seat.email?.toLowerCase() ?? null,
              phone: seat.phone ?? null,
              dateOfBirth: seat.dateOfBirth ?? null,
              shirtSize: seat.shirtSize ?? null,
              bftMember: seat.bftMember ?? false,
              studioId: seat.studioId ?? null,
            })),
          },
        },
        select: { id: true, number: true, name: true },
        });
      }, { timeout: 15000 });
      return { ok: true, ...team };
    } catch (error) {
      if (error instanceof Error && error.message === "ALREADY_LINKED") return { ok: false, error: "HAS_OTHER_PARTNER" };
      if (error instanceof Error && error.message === "ALREADY_ENTERED") return { ok: false, error: "ALREADY_ENTERED" };
      const constraint = violated(error);
      if (!constraint) throw error;
      if (constraint.includes("externalId")) return { ok: false, error: "ALREADY_ENTERED" };
      if (!constraint.includes("number")) throw error;
      // Somebody took the number. Round again.
    }
  }
  return { ok: false, error: "NUMBER_RACE" };
}
