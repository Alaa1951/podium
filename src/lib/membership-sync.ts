import type { Prisma } from "@/generated/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// DERIVED RELATIONS FOLLOW THE TEAM'S CURRENT MEMBERS.
//
// `SeriesParticipant.partnerUserId` and the partner snapshot are a copy of
// "who is on my team", kept so the entry card and the partner finder can
// answer without reading the roster. A copy drifts; this is the one place it
// is brought back in step, from the seats as they are now — never from an
// older partnership choice, and never re-linking somebody who has left.
//
// Called after a seat is first claimed (link-seats.ts), inside that claim's
// transaction and under its competition lock. Membership changes (replace,
// leave, swap — later releases) call the wider sync that also clears the
// departed person's side. Calling this with nothing changed writes the same
// values again and is safe.
//
// Who holds each seat is read with a LOCKING read, so it is the committed
// roster — a partner who claimed their seat a moment ago is seen, whatever
// snapshot the transaction's earlier reads opened.
// ─────────────────────────────────────────────────────────────────────────────

export async function reconcileDerivedLinks(db: Prisma.TransactionClient, teamId: string): Promise<void> {
  const holders = await db.$queryRaw<{ id: string; userId: string | null }[]>`SELECT id, userId FROM Competitor WHERE teamId = ${teamId} FOR UPDATE`;
  const holderOf = new Map(holders.map((row) => [row.id, row.userId]));
  const found = await db.team.findUnique({
    where: { id: teamId },
    select: {
      seriesId: true, name: true,
      competitors: { select: { id: true, fullName: true, email: true, phone: true, dateOfBirth: true, shirtSize: true, bftMember: true } },
    },
  });
  if (!found) return;
  const team = { ...found, competitors: found.competitors.map((seat) => ({ ...seat, userId: holderOf.get(seat.id) ?? null })) };
  const complete = team.competitors.length === 2;

  for (const seat of team.competitors) {
    if (!seat.userId) continue;
    const other = team.competitors.find((row) => row !== seat) ?? null;
    const participant = await db.seriesParticipant.findUnique({
      where: { seriesId_userId: { seriesId: team.seriesId, userId: seat.userId } },
      select: { id: true },
    });
    if (!participant) continue; // link-seats creates it before calling here
    await db.seriesParticipant.update({
      where: { id: participant.id },
      data: {
        partnerUserId: other?.userId ?? null,
        partnerLinkedAt: other?.userId ? new Date() : null,
        partnerName: other?.fullName ?? null,
        partnerEmail: other?.email ?? null,
        partnerPhone: other?.phone ?? null,
        partnerDateOfBirth: other?.dateOfBirth ?? null,
        partnerShirtSize: other?.shirtSize ?? null,
        partnerBftMember: other?.bftMember ?? false,
        // Only a complete team settles these: a solo entry keeps what the
        // athlete chose (plan §3.3).
        ...(complete ? { lookingForPartner: false, teamName: team.name } : {}),
      },
    });
    if (complete) {
      // A member of a full team cannot pair with anyone else: those requests
      // are not valid any more, whichever way they were going.
      await db.partnerRequest.updateMany({
        where: { seriesId: team.seriesId, status: "pending", OR: [{ fromUserId: seat.userId }, { toUserId: seat.userId }] },
        data: { status: "cancelled" },
      });
    }
  }
}
