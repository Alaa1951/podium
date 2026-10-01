"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { sendAlreadyRegisteredEmail, sendOtpEmail } from "@/lib/email";
import { codeGapLeft, createOtpChallenge, getOtpConfig, startCodeGap } from "@/lib/otp";
import { prisma } from "@/lib/prisma";
import { competitionChoices } from "@/lib/competition-choice";
import { listOpenSignupSeries } from "@/lib/queries";
import { checkRate, MINUTE_MS } from "@/lib/rate-limit";
import { SHIRT_SIZES } from "@/lib/shirt-sizes";
import {
  checkPasswordStrength,
  getBaseUrl,
  getIpFromHeaders,
  hashPassword,
  isValidEmail,
  normalizeEmail,
} from "@/lib/security";

// ─────────────────────────────────────────────────────────────────────────────
// SIGNING UP.
//
// Anyone can ask for an account: an ATHLETE, or an ORGANISER (organiser,
// judge, volunteer, coach — or a Gym/Studio). The account is created waiting
// for approval, and a code goes to the email: typing it in proves the address
// and signs them in (the same code sign-in athletes already use). Until the
// chosen gym or BFT MENA approves them, they see the general pages only.
//
// The reply never says whether an address already has an account — that is
// not something a stranger gets to test. An existing account gets an email
// pointing at sign-in instead of a code.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `resendIn`: seconds before "send the code again" may be pressed — a code
 * went out just now, or one did less than a minute ago and is still the one
 * to type. `retryAfter`: how long a refusal lasts.
 */
export type SignupResult = { ok: true; resendIn?: number } | { ok: false; error: string; retryAfter?: number };

const ORGANISER_KINDS = ["organiser", "judge", "volunteer", "coach", "gym-studio"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

const dateString = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  });

const schema = z
  .object({
    type: z.enum(["athlete", "organiser"]),
    roleKey: z.enum(ORGANISER_KINDS).optional(),
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().max(200),
    phone: z.string().trim().min(6).max(30),
    studioId: optionalText(191),
    seriesId: optionalText(191),
    password: z.string().max(200),
    // Athlete
    dateOfBirth: dateString,
    sex: z.enum(["m", "f"]).optional(),
    division: z.enum(["Rookie", "Open", "Pro"]).optional(),
    category: z.enum(["Womens", "Mens", "Mixed"]).optional(),
    shirtSize: z.enum(SHIRT_SIZES).optional(),
    bftMember: z.boolean().optional(),
    hasPartner: z.boolean().optional(),
    teamName: optionalText(120),
    partnerName: optionalText(120),
    partnerEmail: optionalText(200),
    partnerPhone: optionalText(30),
    partnerDateOfBirth: dateString,
    partnerSex: z.enum(["m", "f"]).optional(),
    partnerShirtSize: z.enum(SHIRT_SIZES).optional(),
    partnerBftMember: z.boolean().optional(),
    // Gym / Studio
    gymName: optionalText(120),
    city: optionalText(80),
  })
  .superRefine((data, ctx) => {
    if (data.type === "organiser" && !data.roleKey) ctx.addIssue({ code: "custom", message: "ROLE_REQUIRED" });
    if (data.type === "athlete") {
      if (!data.dateOfBirth || !data.sex || !data.division || !data.category) {
        ctx.addIssue({ code: "custom", message: "ATHLETE_DETAILS_REQUIRED" });
      }
      if (!data.shirtSize) ctx.addIssue({ code: "custom", message: "SHIRT_SIZE_REQUIRED" });
      if (data.hasPartner) {
        if (!data.partnerName || !data.partnerEmail) {
          ctx.addIssue({ code: "custom", message: "PARTNER_REQUIRED" });
        }
        // A pair competes under a name. Somebody still looking for a partner
        // has nobody to be a team with yet, so they are not asked for one.
        if (!data.teamName) ctx.addIssue({ code: "custom", message: "TEAM_NAME_REQUIRED" });
        if (!data.partnerSex || !data.partnerShirtSize) {
          ctx.addIssue({ code: "custom", message: "PARTNER_DETAILS_REQUIRED" });
        }
      }
    }
    if (data.roleKey === "gym-studio" && !data.gymName) ctx.addIssue({ code: "custom", message: "GYM_REQUIRED" });
  });

/** Start a sign-up: create (or refresh) the waiting account and email a code. */
export async function startSignup(input: unknown): Promise<SignupResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues.find((issue) => issue.code === "custom")?.message;
    return { ok: false, error: message ?? "INVALID_INPUT" };
  }
  const data = parsed.data;
  const email = normalizeEmail(data.email);
  if (!isValidEmail(email)) return { ok: false, error: "EMAIL_INVALID" };
  if (data.hasPartner && data.partnerEmail && !isValidEmail(normalizeEmail(data.partnerEmail))) {
    return { ok: false, error: "PARTNER_EMAIL_INVALID" };
  }

  const ip = getIpFromHeaders(await headers());
  // Per address and per network, separately: a gym signing up its members on
  // one Wi-Fi must not be throttled as one person.
  const perEmail = checkRate(`signup:email:${email}`, 5, 15 * MINUTE_MS);
  const perIp = checkRate(`signup:ip:${ip ?? "unknown"}`, 40, 15 * MINUTE_MS);
  if (!perEmail.ok) return { ok: false, error: "TOO_MANY", retryAfter: perEmail.retryAfter };
  if (!perIp.ok) return { ok: false, error: "TOO_MANY", retryAfter: perIp.retryAfter };
  // A code (or the "already registered" email) went to this address less
  // than a minute ago: it is still the one to use — the details are saved,
  // no second code races the first. Known or not, the answer is the same.
  const gap = codeGapLeft(email);
  const { resendCooldownSeconds } = getOtpConfig();

  // An ATHLETE may leave the password empty: the emailed code is a complete
  // way in, now and later (/athlete), and a password can be created any time
  // from Account. Everyone else sets one. A password that IS given must be a
  // good one. Either way the code is what proves the address the first time.
  const athleteSignup = data.type === "athlete";
  const password = data.password ?? "";
  let passwordHash: string | null = null;
  if (password || !athleteSignup) {
    const strength = checkPasswordStrength(password);
    if (!strength.ok) return { ok: false, error: strength.reason };
    passwordHash = await hashPassword(password);
  }

  const studioId = data.studioId
    ? (await prisma.studio.findFirst({ where: { id: data.studioId, isActive: true }, select: { id: true } }))?.id ?? null
    : null;

  // WHICH COMPETITION. Validated here rather than in the schema, because only
  // the server knows whether any are on offer: with none open the field is
  // not rendered and must not be demanded.
  const requestedSeries = data.seriesId ? await prisma.series.findFirst({
    where: { id: data.seriesId, signupOpen: true, isTraining: false, status: { in: ["scheduled", "live"] }, archivedAt: null, isActive: true },
  }) : null;
  const seriesId = requestedSeries && competitionChoices([requestedSeries]).length ? requestedSeries.id : null;
  if (athleteSignup && !seriesId && (data.seriesId || (await listOpenSignupSeries()).length > 0)) {
    return { ok: false, error: "COMPETITION_REQUIRED" };
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, status: true, signupType: true, approvalStatus: true },
  });

  // An address that already has an account is told so BY EMAIL, never on
  // screen (the screen must not confirm that an address is registered).
  //
  // An address that sits on a team's seat but has no account signs up like
  // anybody else: the account waits for approval, and once the code proves
  // the address the seat links to it (link-seats.ts) — a paid entry approves
  // it, an unpaid, waiting-list or training one does not. The code door
  // mints accounts only for competing entries, so turning the others away
  // here too would leave them no way in at all.
  const unfinished = existing && existing.signupType && existing.status === "invited";
  if (existing && !unfinished) {
    if (gap) return { ok: true, resendIn: gap };
    startCodeGap(email);
    try {
      await sendAlreadyRegisteredEmail({
        email,
        url: `${getBaseUrl()}${existing.role === "competitor" ? "/athlete" : "/login"}`,
      });
    } catch {
      // Same reply either way.
    }
    return { ok: true, resendIn: resendCooldownSeconds };
  }

  const athlete = data.type === "athlete";
  const fields = {
    name: data.name,
    phone: data.phone,
    // The account type: athletes compete; everyone else starts as an
    // organiser (a Gym/Studio request becomes a studio account on approval).
    role: athlete ? ("competitor" as const) : ("organiser" as const),
    status: "invited" as const,
    approvalStatus: "pending" as const,
    signupType: data.type,
    signupAt: new Date(),
    requestedRoleKey: athlete ? "athlete" : data.roleKey!,
    requestedStudioId: studioId,
    requestedSeriesId: seriesId,
    requestedStudioName: data.roleKey === "gym-studio" ? data.gymName ?? null : null,
    requestedCity: data.roleKey === "gym-studio" ? data.city ?? null : null,
    passwordHash,
  };
  const profile = athlete
    ? {
        dateOfBirth: data.dateOfBirth ?? null,
        sex: data.sex ?? null,
        division: data.division ?? null,
        category: data.category ?? null,
        shirtSize: data.shirtSize ?? null,
        bftMember: data.bftMember ?? false,
        lookingForPartner: !data.hasPartner,
        // Everything about the pair is cleared when there is no partner, so a
        // change of mind cannot leave a half-registered second seat behind.
        teamName: data.hasPartner ? data.teamName ?? null : null,
        partnerName: data.hasPartner ? data.partnerName ?? null : null,
        partnerEmail: data.hasPartner && data.partnerEmail ? normalizeEmail(data.partnerEmail) : null,
        partnerPhone: data.hasPartner ? data.partnerPhone ?? null : null,
        partnerDateOfBirth: data.hasPartner ? data.partnerDateOfBirth ?? null : null,
        partnerSex: data.hasPartner ? data.partnerSex ?? null : null,
        partnerShirtSize: data.hasPartner ? data.partnerShirtSize ?? null : null,
        partnerBftMember: data.hasPartner ? data.partnerBftMember ?? false : false,
      }
    : null;

  const user = unfinished
    ? await prisma.user.update({ where: { id: existing!.id }, data: fields, select: { id: true } })
    : await prisma.user.create({ data: { email, ...fields }, select: { id: true } });

  if (profile) {
    await prisma.athleteProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...profile },
      update: profile,
    });
  } else {
    await prisma.athleteProfile.deleteMany({ where: { userId: user.id } });
  }

  if (athlete && seriesId && profile) {
    const entryFields = { ...profile, dateOfBirth: undefined, sex: undefined };
    delete entryFields.dateOfBirth;
    delete entryFields.sex;
    await prisma.seriesParticipant.upsert({
      where: { seriesId_userId: { seriesId, userId: user.id } },
      create: { seriesId, userId: user.id, ...entryFields },
      update: entryFields,
    });
  }

  // The code is a sign-in code: typing it in proves the address and signs in.
  if (gap) return { ok: true, resendIn: gap };
  const { code } = await createOtpChallenge({ userId: user.id, purpose: "login", sentTo: email, ip });
  try {
    await sendOtpEmail({ email, code, ttlMinutes: getOtpConfig().ttlMinutes });
  } catch {
    return { ok: false, error: "EMAIL_SEND_FAILED" };
  }
  return { ok: true, resendIn: resendCooldownSeconds };
}

/** Send the sign-up code again, for an account still finishing its sign-up. */
export async function resendSignupCode(input: unknown): Promise<SignupResult> {
  const parsed = z.object({ email: z.string().trim().max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const email = normalizeEmail(parsed.data.email);
  // Before the allowance: pressing again while the last code is on its way
  // costs nothing, and replaces nothing.
  const gap = codeGapLeft(email);
  if (gap) return { ok: false, error: "RESEND_COOLDOWN", retryAfter: gap };
  const rate = checkRate(`signup-resend:${email}`, 3, 15 * MINUTE_MS);
  if (!rate.ok) return { ok: false, error: "TOO_MANY", retryAfter: rate.retryAfter };

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true, signupType: true } });
  if (user?.signupType && user.status === "invited") {
    const { code } = await createOtpChallenge({ userId: user.id, purpose: "login", sentTo: email });
    try {
      await sendOtpEmail({ email, code, ttlMinutes: getOtpConfig().ttlMinutes });
    } catch {
      return { ok: false, error: "EMAIL_SEND_FAILED" };
    }
  } else {
    startCodeGap(email);
  }
  return { ok: true, resendIn: getOtpConfig().resendCooldownSeconds };
}
