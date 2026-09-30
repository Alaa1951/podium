"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { setTeamArrival } from "@/lib/checkin-db";
import { getCurrentUser, requireAccess } from "@/lib/session";
import { optionalText, toMinor } from "@/lib/actions/registration-fields";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

// Confirming, holding and reversing a registration's payment, and marking who
// actually turned up. Only a paid registration reaches the board, which is why
// none of this is a deletion.

const paymentSchema = z.object({
  teamId: z.string().min(1),
  status: z.enum(["pending", "paid", "refunded"]),
  amount: optionalText,
  currency: optionalText,
  billingNumber: optionalText,
  note: optionalText,
});

/**
 * Confirm, hold or reverse a registration's payment.
 *
 * Money taken at the door is recorded here with its amount and who confirmed
 * it, so a figure on a report can always be traced to a person. Only a paid
 * registration reaches the board — which is why this is a status change and
 * never a deletion.
 */
export async function setPayment(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("registrations.payment");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { teamId, status, amount, currency, billingNumber, note } = parsed.data;

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, seriesId: true, number: true, name: true, paymentStatus: true },
  });
  if (!team) return { ok: false, error: "NOT_FOUND" };

  const minor = toMinor(amount);

  await prisma.team.update({
    where: { id: teamId },
    data: {
      paymentStatus: status,
      paidAt: status === "paid" ? new Date() : null,
      confirmedById: status === "paid" ? actor.id : null,
      ...(minor !== null ? { amountMinor: minor } : {}),
      ...(currency ? { currency } : {}),
      ...(billingNumber !== null ? { billingNumber } : {}),
      ...(note !== null ? { paymentNote: note } : {}),
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.paymentChanged,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${team.name}`,
    detail: `${team.paymentStatus} → ${status}${billingNumber ? ` · ${billingNumber}` : ""}`,
  });

  revalidateCompetitionViews();
  return { ok: true };
}

/**
 * The whole team checked in at the entrance, or not after all.
 *
 * Check-in is floor work (registrations.attendance — the Organiser's, a
 * volunteer's, a gym's for its own teams); whoever confirms payment may do it
 * too. Answered, never redirected: it is pressed from the entrance and
 * marshalling screens mid-call-up, and a redirect there loses the page.
 *
 * The key, the scope (a gym reaches only its own teams) and the write are
 * checkin-db.ts. Pressing twice — or two volunteers at once — is one
 * check-in: the first time stands and only one audit line is written.
 * One athlete at a time is `setAthleteAttendance` (actions/checkin.ts).
 */
export async function setAttendance(input: unknown): Promise<ActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "UNAUTHENTICATED" };
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = z
    .object({ teamId: z.string().min(1), attended: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const outcome = await setTeamArrival(prisma, actor, parsed.data);
  if (!outcome.ok) return outcome;
  if (!outcome.changed) return { ok: true };

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.attendanceChanged,
    targetType: "team",
    targetId: outcome.team.id,
    targetLabel: outcome.team.label,
    detail: outcome.detail,
  });

  revalidateCompetitionViews();
  return { ok: true };
}
