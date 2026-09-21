"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { can } from "@/lib/access";
import { AUDIT, recordAudit } from "@/lib/audit";
import { sendPartnerUnlinkedEmail } from "@/lib/email";
import { onAthleteVerified, unlinkPair } from "@/lib/partners";
import { prisma } from "@/lib/prisma";
import { checkRate, MINUTE_MS } from "@/lib/rate-limit";
import { getBaseUrl, isValidEmail, normalizeEmail } from "@/lib/security";
import { requireRole } from "@/lib/session";
import { teamEditOpen } from "@/lib/visibility";

// ─────────────────────────────────────────────────────────────────────────────
// AN ATHLETE'S PARTNER — named by the athlete, or "looking for a partner".
//
// Naming someone never links them on its own: the pair is linked when each
// names the other, or when the named athlete was looking for one
// (partners.ts). Once linked, the pair is fixed here; a studio or BFT MENA
// pairs people into a team.
// ─────────────────────────────────────────────────────────────────────────────

export type PartnerResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  hasPartner: z.boolean(),
  partnerName: z.string().trim().max(120).optional(),
  partnerEmail: z.string().trim().max(200).optional(),
  partnerPhone: z.string().trim().max(30).optional(),
  division: z.enum(["Rookie", "Open", "Pro"]),
  category: z.enum(["Womens", "Mens", "Mixed"]),
});

export async function savePartner(input: unknown): Promise<PartnerResult> {
  const user = await requireRole("competitor");
  if (user.viewAs || !can(user, "partner.edit")) return { ok: false, error: "FORBIDDEN" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const data = parsed.data;

  const current = await prisma.athleteProfile.findUnique({
    where: { userId: user.id },
    select: { partnerUserId: true },
  });
  if (current?.partnerUserId) return { ok: false, error: "ALREADY_LINKED" };

  let partnerEmail: string | null = null;
  if (data.hasPartner) {
    if (!data.partnerName || !data.partnerEmail) return { ok: false, error: "PARTNER_REQUIRED" };
    partnerEmail = normalizeEmail(data.partnerEmail);
    if (!isValidEmail(partnerEmail)) return { ok: false, error: "PARTNER_EMAIL_INVALID" };
    if (partnerEmail === normalizeEmail(user.email)) return { ok: false, error: "PARTNER_IS_YOU" };
  }

  const fields = {
    division: data.division,
    category: data.category,
    lookingForPartner: !data.hasPartner,
    partnerName: data.hasPartner ? data.partnerName ?? null : null,
    partnerEmail,
    partnerPhone: data.hasPartner ? data.partnerPhone || null : null,
  };
  await prisma.athleteProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...fields },
    update: fields,
  });

  // Naming a partner is the end of looking for one, so the asks this athlete
  // sent are withdrawn. Asks they RECEIVED are left alone — those are other
  // people's, and this athlete can still answer them properly.
  if (data.hasPartner) {
    await prisma.partnerRequest.updateMany({
      where: { fromUserId: user.id, status: "pending" },
      data: { status: "withdrawn", openPairKey: null, respondedAt: new Date() },
    });
  }

  // The athlete's own address is proven — they are signed in with it.
  await onAthleteVerified(user.id, user.email).catch(() => undefined);

  // The old email flow may have just linked them. Anything still open on
  // either side of that pair is moot now.
  const linked = await prisma.athleteProfile.findUnique({
    where: { userId: user.id },
    select: { partnerUserId: true },
  });
  if (linked?.partnerUserId) {
    const pair = [user.id, linked.partnerUserId];
    await prisma.partnerRequest.updateMany({
      where: {
        status: "pending",
        OR: [{ fromUserId: { in: pair } }, { toUserId: { in: pair } }],
      },
      data: { status: "cancelled", openPairKey: null, respondedAt: new Date() },
    });
  }

  revalidatePath("/me");
  revalidatePath("/me/partner");
  revalidatePath("/me/partner/requests");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANGING WHO YOUR PARTNER IS.
//
// Unlinking, then the ordinary flow — two deliberate steps rather than one.
// Making `savePartner` unlink implicitly would mean a mis-tapped form save
// dissolves somebody's pair.
//
// The door closes on the competition's own clock (teamEditCloseHours), and it
// is shut entirely once a team has been entered: swapping somebody on a
// registered team is staff's to do, because it touches a wave, a station and
// possibly a payment.
//
// ONE CONSEQUENCE, so the next reader does not take it for a bug: the
// `accepted` PartnerRequest row survives, so each of them stays out of the
// other's finder for good. That is right — "we tried that" — and they can
// still name each other by email here if they change their minds.
// ─────────────────────────────────────────────────────────────────────────────

export async function unlinkPartner(): Promise<PartnerResult> {
  const user = await requireRole("competitor");
  if (user.viewAs || !can(user, "partner.edit")) return { ok: false, error: "FORBIDDEN" };

  // Unlinking emails somebody else, so it gets the same treatment as asking.
  if (!checkRate(`partner-unlink:${user.id}`, 5, 15 * MINUTE_MS).ok) {
    return { ok: false, error: "TRY_LATER" };
  }

  const mine = await prisma.athleteProfile.findUnique({
    where: { userId: user.id },
    select: { partnerUserId: true },
  });
  const partnerId = mine?.partnerUserId;
  if (!partnerId) return { ok: false, error: "NOT_LINKED" };

  // Already entered in a competition? Then this is staff's to change.
  const entered = await prisma.competitor.findFirst({
    where: {
      userId: { in: [user.id, partnerId] },
      team: { archivedAt: null, series: { status: { not: "final" } } },
    },
    select: { id: true },
  });
  if (entered) return { ok: false, error: "TEAM_REGISTERED" };

  // The deadline belongs to the competition they signed up for. Without one
  // there is nothing to count back from, and the door stays open.
  const chosen = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      requestedSeries: { select: { competitionDate: true, teamEditCloseHours: true } },
    },
  });
  if (chosen?.requestedSeries) {
    const door = teamEditOpen({
      competitionDate: chosen.requestedSeries.competitionDate,
      teamEditCloseHours: chosen.requestedSeries.teamEditCloseHours,
      now: new Date(),
    });
    if (!door.open) return { ok: false, error: "TEAM_EDIT_CLOSED" };
  }

  const partner = await prisma.user.findUnique({
    where: { id: partnerId },
    select: { email: true },
  });

  try {
    await prisma.$transaction(async (tx) => {
      // Conditional, so two unlinks at the same instant cannot half-run.
      const claimed = await tx.athleteProfile.updateMany({
        where: { userId: user.id, partnerUserId: partnerId },
        data: { partnerUserId: null },
      });
      if (claimed.count === 0) throw new Error("NOT_LINKED");
      await unlinkPair(user.id, partnerId, tx);
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_LINKED") return { ok: false, error: code };
    console.error("[PARTNER:unlink]", code || error);
    return { ok: false, error: "FAILED" };
  }

  if (partner?.email) {
    try {
      await sendPartnerUnlinkedEmail({
        email: partner.email,
        byName: user.name ?? "",
        url: `${getBaseUrl()}/me/partner`,
      });
    } catch {
      // The change stands whether or not the email went out.
    }
  }

  await recordAudit({
    actorId: user.id,
    action: AUDIT.partnerUnlinked,
    targetType: "user",
    targetId: partnerId,
    targetLabel: partner?.email ?? "",
  });

  revalidatePath("/me");
  revalidatePath("/me/partner");
  revalidatePath("/me/partner/requests");
  revalidatePath("/studio/people");
  return { ok: true };
}
