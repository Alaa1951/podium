"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { can } from "@/lib/access";
import { onAthleteVerified } from "@/lib/partners";
import { prisma } from "@/lib/prisma";
import { isValidEmail, normalizeEmail } from "@/lib/security";
import { requireRole } from "@/lib/session";

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

  // The athlete's own address is proven — they are signed in with it.
  await onAthleteVerified(user.id, user.email).catch(() => undefined);
  revalidatePath("/me");
  return { ok: true };
}
