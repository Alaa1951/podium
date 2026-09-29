"use server";

import { z } from "zod";

import { isBft } from "@/lib/access";
import { AUDIT, recordAuditIn } from "@/lib/audit";
import { registrantSeat, type Ownership } from "@/lib/ownership";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { requireAccess } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// SETTING WHO REGISTERED A TEAM — BFT MENA only (plan v7 §4).
//
// The CRM payer's email sets it where it can (ownership.ts); everything else
// is `unknown` until somebody who knows says otherwise. Nothing infers it —
// not seat order, not who asked whom, not whose account came first. Every
// change is audited with before and after.
// ─────────────────────────────────────────────────────────────────────────────

export type OwnershipResult = { ok: true } | { ok: false; error: string };

const schema = z
  .object({
    teamId: z.string().min(1),
    ownership: z.enum(["registrant", "joint", "unknown"]),
    /** Required for `registrant`: the seat of the person who registered. */
    registrantSeatId: z.string().min(1).optional(),
    /** The team's membership version the page showed. */
    expectedVersion: z.number().int().min(0).optional(),
  })
  .refine((data) => data.ownership !== "registrant" || Boolean(data.registrantSeatId), { message: "SEAT_REQUIRED" });

const describe = (ownership: Ownership, email: string | null) =>
  ownership === "registrant" ? `registrant ${email ?? "—"}` : ownership;

export async function setTeamOwnership(input: unknown): Promise<OwnershipResult> {
  const actor = await requireAccess("registrations.edit");
  if (actor.viewAs || !isBft(actor)) return { ok: false, error: "FORBIDDEN" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message === "SEAT_REQUIRED" ? "SEAT_REQUIRED" : "INVALID_INPUT" };
  const data = parsed.data;

  const found = await prisma.team.findUnique({ where: { id: data.teamId }, select: { seriesId: true } });
  if (!found) return { ok: false, error: "NOT_FOUND" };

  let changed = false;
  const outcome = await prisma.$transaction(async (tx): Promise<OwnershipResult> => {
    // Every writer of a team's membership takes the competition lock.
    await tx.$queryRaw`SELECT id FROM Series WHERE id = ${found.seriesId} FOR UPDATE`;
    const team = await tx.team.findUnique({
      where: { id: data.teamId },
      select: {
        id: true, number: true, name: true, archivedAt: true, membershipVersion: true,
        ownership: true, registrantEmail: true, registrantUserId: true,
        competitors: { select: { id: true, userId: true, email: true } },
      },
    });
    if (!team || team.archivedAt) return { ok: false, error: "NOT_FOUND" };
    // Who may change the team depends on this: a page opened before somebody
    // else changed the team must not decide on what it no longer shows.
    if (data.expectedVersion !== undefined && data.expectedVersion !== team.membershipVersion) return { ok: false, error: "STALE_MEMBERSHIP" };

    let update: { ownership: Ownership; registrantEmail: string | null; registrantUserId: string | null };
    if (data.ownership === "registrant") {
      const seat = team.competitors.find((one) => one.id === data.registrantSeatId);
      if (!seat) return { ok: false, error: "SEAT_NOT_ON_TEAM" };
      // An identity needs an address: a seat without one cannot be the
      // registrant (the email is what the athlete signs in with).
      if (!seat.email) return { ok: false, error: "SEAT_HAS_NO_EMAIL" };
      update = { ownership: "registrant", registrantEmail: seat.email.toLowerCase(), registrantUserId: seat.userId };
    } else {
      update = { ownership: data.ownership, registrantEmail: null, registrantUserId: null };
    }

    const unchanged =
      team.ownership === update.ownership &&
      (team.registrantEmail ?? null) === update.registrantEmail &&
      (update.ownership !== "registrant" || registrantSeat(team)?.id === data.registrantSeatId);
    if (unchanged) return { ok: true };

    // Who may change the team is a membership fact: the version moves, so a
    // request prepared under the old owner is refused as stale.
    await tx.team.update({ where: { id: team.id }, data: { ...update, membershipVersion: { increment: 1 } } });
    // In the same transaction: no audit line, no change.
    await recordAuditIn(tx, {
      actorId: actor.id,
      action: AUDIT.teamOwnershipChanged,
      targetType: "team",
      targetId: team.id,
      targetLabel: `${team.number} ${team.name}`,
      detail: `${describe(team.ownership, team.registrantEmail)} → ${describe(update.ownership, update.registrantEmail)}`,
    });
    changed = true;
    return { ok: true };
  });
  if (!outcome.ok) return outcome;
  if (changed) revalidateCompetitionViews();
  return { ok: true };
}
