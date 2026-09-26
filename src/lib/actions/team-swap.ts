"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { alreadyEntered } from "@/lib/one-entry";
import { linkPair, unlinkPair } from "@/lib/partners";
import { ensureParticipation } from "@/lib/participation";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { normalizeName } from "@/lib/scoring";
import { isValidEmail, normalizeEmail } from "@/lib/security";
import { isStudio, requireAccess, teamScope } from "@/lib/session";
import { registrationOpen } from "@/lib/visibility";

// ─────────────────────────────────────────────────────────────────────────────
// SWAPPING SOMEBODY ON A REGISTERED TEAM.
//
// The case this exists for: it is the morning of the competition, one of a pair
// has not turned up, and somebody else steps in. The athlete's own door
// (`unlinkPartner`) is shut as soon as a team is entered, because a change there
// touches a wave, a station and possibly a payment. This is the staff door, and
// it stays open later — right up to the moment the wave starts.
//
// WHAT CLOSES IT, in the order it is checked:
//   • the competition is finished        — the field is the record now
//   • the team has a score               — a swap would rewrite who earned it
//   • the wave is no longer `pending`    — they are on the floor
//
// `deletionGuard` is deliberately NOT used: it refuses a `live` series, and a
// swap on the morning of a live competition is the whole point of this action.
// The wave's STATUS is the gate, not the clock — a wave can start early or late,
// and only its status knows which.
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
  })
  .refine((data) => Boolean(data.replacementUserId) || Boolean(data.fullName), {
    message: "NAME_REQUIRED",
  });

export async function swapTeamMember(input: unknown): Promise<SwapResult> {
  // The same permission that pairs two athletes into a team: this is that act,
  // one seat at a time. A new key would be another migration that has to reach
  // production before the screen means anything.
  const actor = await requireAccess("registrations.pair");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "NAME_REQUIRED" };
  const data = parsed.data;

  const seat = await prisma.competitor.findFirst({
    where: { id: data.competitorId, team: { archivedAt: null, ...teamScope(actor) } },
    select: {
      id: true,
      position: true,
      fullName: true,
      email: true,
      userId: true,
      team: {
        select: {
          id: true,
          seriesId: true,
          number: true,
          name: true,
          waveId: true,
          waveRef: { select: { status: true } },
          score: { select: { id: true } },
          series: { select: { status: true, registrationClosesAt: true } },
          competitors: { select: { id: true, userId: true } },
        },
      },
    },
  });
  if (!seat) return { ok: false, error: "NOT_FOUND" };
  const team = seat.team;

  if (team.series.status === "final") return { ok: false, error: "SERIES_FINISHED" };
  if (team.score) return { ok: false, error: "TEAM_ALREADY_SCORED" };
  // A team with no wave yet simply has nothing to be late for — unlike
  // `setTeamStation`, which needs one to move within.
  if (team.waveId && team.waveRef?.status !== "pending") {
    return { ok: false, error: "WAVE_STARTED" };
  }
  // After registration closes, who is on a team is BFT MENA's to change — the
  // same rule as editing the registration (readSwapSeat shows it closed).
  const deadline = registrationOpen({ role: actor.role, registrationClosesAt: team.series.registrationClosesAt, now: new Date() });
  if (!deadline.open) return { ok: false, error: deadline.reason };

  // The other half of the pair, whose partner link has to follow this change.
  const otherUserId =
    team.competitors.find((one) => one.id !== seat.id)?.userId ?? null;

  let replacement: {
    userId: string | null;
    fullName: string;
    email: string | null;
    phone: string | null;
    dateOfBirth: Date | null;
    shirtSize: "XS" | "S" | "M" | "L" | "XL" | "XXL" | null;
    bftMember: boolean;
    studioId: string | null;
    hasProfile: boolean;
  };

  if (data.replacementUserId) {
    if (data.replacementUserId === seat.userId) return { ok: true };
    if (data.replacementUserId === otherUserId) return { ok: false, error: "SAME_ATHLETE" };

    const account = await prisma.user.findFirst({
      where: {
        id: data.replacementUserId,
        role: "competitor",
        approvalStatus: "approved",
        archivedAt: null,
        status: { not: "disabled" },
        // A studio brings in its own athlete. BFT MENA may bring in anyone —
        // on the day, the substitute is as likely to be from another studio.
        ...(isStudio(actor) && actor.studioId ? { studioId: actor.studioId } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        studioId: true,
        athleteProfile: {
          select: { dateOfBirth: true, shirtSize: true, bftMember: true, partnerUserId: true },
        },
      },
    });
    if (!account) return { ok: false, error: "ATHLETE_NOT_FOUND" };

    // Nobody competes twice in the same competition.
    const already = await alreadyEntered({
      seriesId: team.seriesId,
      userIds: [account.id],
      emails: [account.email],
      exceptCompetitorId: seat.id,
    });
    if (already) return { ok: false, error: "ALREADY_ENTERED" };

    replacement = {
      userId: account.id,
      fullName: account.name ?? account.email,
      email: account.email.toLowerCase(),
      phone: account.phone,
      dateOfBirth: account.athleteProfile?.dateOfBirth ?? null,
      shirtSize: account.athleteProfile?.shirtSize ?? null,
      bftMember: account.athleteProfile?.bftMember ?? false,
      studioId: account.studioId,
      hasProfile: Boolean(account.athleteProfile),
    };
  } else {
    let email: string | null = null;
    if (data.email) {
      email = normalizeEmail(data.email);
      if (!isValidEmail(email)) return { ok: false, error: "EMAIL_INVALID" };
    }
    // A typed-in substitute takes the seat as a name on the roster. They are
    // not given an account here — that is the sign-up's job, not a swap's.
    replacement = {
      userId: null,
      fullName: data.fullName!.trim(),
      email,
      phone: data.phone?.trim() || null,
      dateOfBirth: null,
      shirtSize: null,
      bftMember: false,
      studioId: isStudio(actor) ? actor.studioId ?? null : null,
      hasProfile: false,
    };
  }

  const outgoing = { userId: seat.userId, label: seat.fullName };

  try {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Series WHERE id = ${team.seriesId} FOR UPDATE`;
    if (await alreadyEntered({ seriesId: team.seriesId, userIds: [replacement.userId], emails: [replacement.email], exceptCompetitorId: seat.id }, tx)) throw new Error("ALREADY_ENTERED");
    if (replacement.userId) {
      const entry = await ensureParticipation(replacement.userId, team.seriesId, tx);
      replacement.shirtSize = entry.shirtSize;
      replacement.bftMember = entry.bftMember;
    }
    await tx.competitor.update({
      where: { id: seat.id },
      data: {
        fullName: replacement.fullName,
        normalizedName: normalizeName(replacement.fullName),
        email: replacement.email,
        phone: replacement.phone,
        dateOfBirth: replacement.dateOfBirth,
        shirtSize: replacement.shirtSize,
        bftMember: replacement.bftMember,
        studioId: replacement.studioId,
        userId: replacement.userId,
      },
    });

    // ── The part that must not be forgotten ──────────────────────────────────
    // A swap has to move the partner link with it. Leave it and
    // `partnerUserId` points at somebody who is no longer on the team, and
    // `/me` lies to two people at once: the one who left still sees the pair,
    // and the one who arrived does not.
    if (outgoing.userId && otherUserId) {
      const linked = await tx.seriesParticipant.count({
        where: { seriesId: team.seriesId, userId: outgoing.userId, partnerUserId: otherUserId },
      });
      if (linked) await unlinkPair(outgoing.userId, otherUserId, team.seriesId, tx);
    }
    if (replacement.userId && replacement.hasProfile && otherUserId) {
      const other = await tx.seriesParticipant.count({ where: { seriesId: team.seriesId, userId: otherUserId } });
      if (other) await linkPair(replacement.userId, otherUserId, team.seriesId, tx);
    }

    // Whoever arrives has a partner now, so their open asks are moot — and so
    // are anybody's to them.
    if (replacement.userId) {
      await tx.partnerRequest.updateMany({
        where: {
          seriesId: team.seriesId,
          status: "pending",
          OR: [{ fromUserId: replacement.userId }, { toUserId: replacement.userId }],
        },
        data: { status: "cancelled", openPairKey: null, respondedAt: new Date() },
      });
    }
  });
  } catch (error) {
    if (error instanceof Error && ["ALREADY_ENTERED", "ALREADY_LINKED"].includes(error.message)) return { ok: false, error: error.message === "ALREADY_LINKED" ? "HAS_OTHER_PARTNER" : error.message };
    throw error;
  }

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.teamMemberSwapped,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${team.name}`,
    detail: `position ${seat.position}: ${outgoing.label} → ${replacement.fullName}`,
  });

  // No email to the person who left. On the day this is a substitution for
  // somebody who did not turn up, and "you are looking for a partner again"
  // would be the wrong thing to send them — staff are already talking to them.

  revalidateCompetitionViews();
  revalidatePath("/me");
  revalidatePath("/me/partner");
  revalidatePath("/studio/people");
  return { ok: true, message: `${replacement.fullName} now stands on team ${team.number}.` };
}
