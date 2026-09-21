"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { sendWaitlistDecisionEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { getBaseUrl } from "@/lib/security";
import { requireAccess, teamScope } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// THE WAITING LIST: letting somebody in, and putting them back.
//
// A place in a competition is the scarce thing in this system — the wave plan
// and the nine stations per wave are built on the number of entries. So this is
// the one action that hands one out, and it is `registrations.waitlist`,
// deliberately separate from `registrations.payment`: whoever confirms money
// is not thereby deciding how many people the floor can hold.
//
// MONEY IS NOT MENTIONED HERE, and that is the whole point of the feature.
// Somebody on the list may have paid weeks ago; it buys them nothing, and this
// action neither reads nor changes `paymentStatus`. An admitted entry that has
// not paid is simply an unpaid entry, like any other.
//
// IT GOES BOTH WAYS. A mis-click that admits the wrong pair has to be
// undoable, or the only fix would be withdrawing a real entry. Putting one back
// is refused once there is a score against it — by then it has competed, and
// the record is the record.
// ─────────────────────────────────────────────────────────────────────────────

export type WaitlistResult = { ok: true; message?: string } | { ok: false; error: string };

const schema = z.object({
  teamId: z.string().min(1),
  /** True puts the entry back on the list; false admits it into the field. */
  waiting: z.boolean(),
});

export async function setWaitlist(input: unknown): Promise<WaitlistResult> {
  const actor = await requireAccess("registrations.waitlist");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { teamId, waiting } = parsed.data;

  const team = await prisma.team.findFirst({
    where: { id: teamId, archivedAt: null, ...teamScope(actor) },
    select: {
      id: true,
      number: true,
      name: true,
      waitlistedAt: true,
      score: { select: { id: true } },
      series: { select: { name: true, slug: true, status: true } },
      competitors: { select: { email: true } },
    },
  });
  if (!team) return { ok: false, error: "NOT_FOUND" };

  // A finished competition is its own record; its field cannot be re-decided.
  if (team.series.status === "final") return { ok: false, error: "SERIES_FINISHED" };
  if (waiting && team.score) return { ok: false, error: "TEAM_ALREADY_SCORED" };

  // Conditional on the state it is being moved OUT of, so two people pressing
  // at once do not both report success for the same change.
  const moved = await prisma.team.updateMany({
    where: { id: team.id, waitlistedAt: waiting ? null : { not: null } },
    data: { waitlistedAt: waiting ? new Date() : null },
  });
  if (moved.count === 0) {
    return { ok: false, error: waiting ? "ALREADY_WAITING" : "ALREADY_ADMITTED" };
  }

  await recordAudit({
    actorId: actor.id,
    action: waiting ? AUDIT.waitlistReturned : AUDIT.waitlistAdmitted,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${team.name}`,
    detail: waiting ? "returned to the waiting list" : "admitted from the waiting list",
  });

  // Both people are told, because both of them have been waiting to know. The
  // decision stands whether or not the email goes out.
  const addresses = team.competitors.map((one) => one.email).filter((one): one is string => Boolean(one));
  for (const email of addresses) {
    try {
      await sendWaitlistDecisionEmail({
        email,
        admitted: !waiting,
        competition: team.series.name,
        teamName: team.name,
        url: `${getBaseUrl()}/me`,
      });
    } catch {
      // Best-effort, one address at a time: one bad address must not silence
      // the other person on the team.
    }
  }

  revalidateCompetitionViews();
  revalidatePath("/me");
  return {
    ok: true,
    message: waiting
      ? `${team.name} is back on the waiting list.`
      : `${team.name} is in. Confirm their payment when it arrives.`,
  };
}
