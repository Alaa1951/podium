"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { requireAccess } from "@/lib/session";
import { correctSeat } from "@/lib/staff-membership";

// ─────────────────────────────────────────────────────────────────────────────
// CORRECTING ONE ATHLETE ON A TEAM — the Edit button beside each athlete on
// the team's page (the console's and a gym's). The same person put right:
// somebody else in the seat is a swap (team-swap.ts). Every rule — who, when,
// which fields, the athlete's request after the cutoff — is decided inside the
// transaction (staff-membership.ts › correctSeat).
// ─────────────────────────────────────────────────────────────────────────────

export type CorrectResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  competitorId: z.string().min(1),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  /** yyyy-mm-dd, or empty. */
  dateOfBirth: z.string().trim().max(10).optional(),
  /** Staff confirmed the athlete asked for this change and approves it. */
  assisted: z.boolean().optional(),
  /** Full access confirmed a signed-in athlete's sign-in email changes. */
  confirmAccountEmail: z.boolean().optional(),
  /** The team's membership version the page showed. */
  expectedVersion: z.number().int().min(0).optional(),
});

export async function correctTeamAthlete(input: unknown): Promise<CorrectResult> {
  const actor = await requireAccess("registrations.edit");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const data = parsed.data;
  const born = data.dateOfBirth ? new Date(data.dateOfBirth) : null;

  const outcome = await correctSeat(prisma, actor, {
    competitorId: data.competitorId,
    fullName: data.fullName,
    email: data.email || null,
    phone: data.phone || null,
    dateOfBirth: born && !Number.isNaN(born.getTime()) ? born : null,
    ...(data.assisted ? { assisted: true } : {}),
    ...(data.confirmAccountEmail ? { confirmAccountEmail: true } : {}),
    ...(data.expectedVersion !== undefined ? { expectedVersion: data.expectedVersion } : {}),
  });
  if (!outcome.ok) return outcome;

  revalidateCompetitionViews();
  revalidatePath("/me");
  revalidatePath("/studio/people");
  return { ok: true };
}
