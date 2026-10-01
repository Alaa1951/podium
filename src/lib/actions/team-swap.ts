"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { requireAccess } from "@/lib/session";
import { swapSeat } from "@/lib/staff-membership";

// ─────────────────────────────────────────────────────────────────────────────
// SWAPPING SOMEBODY ON A REGISTERED TEAM.
//
// The case this exists for: it is the morning of the competition, one of a pair
// has not turned up, and somebody else steps in. The athlete's own door is
// shut as soon as a team is entered, because a change there touches a wave, a
// station and possibly a payment. This is the staff door, and it stays open
// later — right up to the moment the wave starts.
//
// WHAT CLOSES IT, in the order it is checked (staff-membership.ts, inside the
// transaction, after the competition lock):
//   • the competition is finished        — the field is the record now
//   • the team has a score               — a swap would rewrite who earned it
//   • the wave is no longer `pending`    — they are on the floor
//   • registration has closed            — for a gym; BFT MENA may still, and
//                                          a gym at the athlete's request
//   • team changes have closed           — Full access, or staff at the
//                                          athlete's request (`assisted`)
//   • the page is out of date            — somebody changed the team first
//   • the seat is the registrant's       — BFT MENA only, with a transfer
//
// THE SEAT IS EDITED IN PLACE. Deleting and re-creating it would touch
// `@@unique([teamId, position])` and risk the team losing its number, wave or
// station — and those are printed on a board and stuck to a rig.
// ─────────────────────────────────────────────────────────────────────────────

export type SwapResult = { ok: true; message?: string } | { ok: false; error: string };

const schema = z
  .object({
    /** The seat being changed, not the team — a team has two. */
    competitorId: z.string().min(1),
    /** An athlete who already has an account… */
    replacementUserId: z.string().min(1).optional(),
    /** …or somebody typed in, which on the day is the common case. */
    fullName: z.string().trim().max(120).optional(),
    email: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(30).optional(),
    /**
     * Replacing the person who registered the team: the replacement becomes
     * the registrant. Required, and BFT MENA's alone — a registrant is never
     * replaced silently, and never by a gym.
     */
    transferOwnership: z.boolean().optional(),
    /** The team's membership version the page showed. */
    expectedVersion: z.number().int().min(0).optional(),
    /**
     * Staff confirmed the athlete asked for this change and approves it —
     * what lets the organiser or a gym make it after team changes close.
     */
    assisted: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.replacementUserId) || Boolean(data.fullName), {
    message: "NAME_REQUIRED",
  });

export async function swapTeamMember(input: unknown): Promise<SwapResult> {
  // The same permission that pairs two athletes into a team: this is that act,
  // one seat at a time.
  const actor = await requireAccess("registrations.pair");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "NAME_REQUIRED" };

  const outcome = await swapSeat(prisma, actor, parsed.data);
  if (!outcome.ok) return { ok: false, error: outcome.error === "INVALID_INPUT" ? "NAME_REQUIRED" : outcome.error };
  if (!outcome.changed) return { ok: true };

  // No email to the person who left. On the day this is a substitution for
  // somebody who did not turn up, and staff are already talking to them.
  revalidateCompetitionViews();
  revalidatePath("/me");
  revalidatePath("/me/partner");
  revalidatePath("/studio/people");
  return { ok: true, message: outcome.message };
}
