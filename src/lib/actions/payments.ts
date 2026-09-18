"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { requireRole } from "@/lib/session";
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
  const actor = await requireRole("admin");

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

/** Checked in on the day, or not after all. */
export async function setAttendance(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = z
    .object({ teamId: z.string().min(1), attended: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const team = await prisma.team.findUnique({
    where: { id: parsed.data.teamId },
    select: { id: true, seriesId: true, number: true, name: true },
  });
  if (!team) return { ok: false, error: "NOT_FOUND" };

  await prisma.team.update({
    where: { id: team.id },
    data: { attendedAt: parsed.data.attended ? new Date() : null },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.attendanceChanged,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${team.name}`,
    detail: parsed.data.attended ? "checked in" : "check-in removed",
  });

  revalidateCompetitionViews();
  return { ok: true };
}
