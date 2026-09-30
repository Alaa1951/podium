import type { Prisma } from "@/generated/prisma/client";
import { normalizeName } from "@/lib/scoring";

// ─────────────────────────────────────────────────────────────────────────────
// A DIFFERENT PERSON IN A SEAT.
//
// A seat's EMAIL is who it is: it is what a sign-in claims the seat with
// (link-seats.ts). So a new email on a seat is a new person, whatever the
// name says — a typo fix and a replacement look the same to the database,
// and are treated the same: nothing of the previous person stays behind.
// Their phone, date of birth, shirt, BFT membership, studio, account link
// and portraits all go; what the caller supplies for the new person takes
// their place. Every path that puts somebody new in a seat comes through
// here — the athlete's Replace, the staff Swap, a staff correction of a
// seat's email — inside the caller's transaction, under the competition lock,
// with the caller's version bump, links sync and audit line beside it.
//
// No account's own email is ever changed to "move" a seat.
// ─────────────────────────────────────────────────────────────────────────────

export type SeatPerson = {
  fullName: string;
  email: string | null;
  userId?: string | null;
  phone?: string | null;
  dateOfBirth?: Date | null;
  shirtSize?: string | null;
  bftMember?: boolean;
  studioId?: string | null;
};

export async function putPersonInSeat(tx: Prisma.TransactionClient, seatId: string, person: SeatPerson): Promise<void> {
  await tx.competitor.update({
    where: { id: seatId },
    data: {
      fullName: person.fullName.trim(),
      normalizedName: normalizeName(person.fullName),
      email: person.email,
      userId: person.userId ?? null,
      phone: person.phone ?? null,
      dateOfBirth: person.dateOfBirth ?? null,
      shirtSize: (person.shirtSize ?? null) as never,
      bftMember: person.bftMember ?? false,
      studioId: person.studioId ?? null,
      // The screens over the rigs must not show the person who left.
      photoPath: null,
      // Nor has the newcomer arrived because the person before them had.
      attendedAt: null,
    },
  });
  await tx.competitorPortrait.deleteMany({ where: { competitorId: seatId } });
  await tx.portraitJob.deleteMany({ where: { competitorId: seatId } });
}
