"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { sendOtpEmail, sendSignUpPointerEmail } from "@/lib/email";
import { codeGapLeft, createOtpChallenge, getOtpConfig, startCodeGap } from "@/lib/otp";
import { issueCompetitorCode } from "@/lib/competitor-access";
import { prisma } from "@/lib/prisma";
import { limitAuthAttempt, NETWORK_LIMITS } from "@/lib/rate-limit";
import { getBaseUrl, getIpFromHeaders } from "@/lib/security";
import { getCurrentUser } from "@/lib/session";

/**
 * Asking for a competitor sign-in code.
 *
 * The answer is always the same sentence. Whether an address competed in
 * PODIUM is not something a stranger gets to find out by typing addresses into
 * a form, so there is no "we don't know that email" to read.
 */
export type RequestResult =
  /** `resendIn`: a code went to this address less than the cooldown ago — it is still the one to use. */
  | { ok: true; resendIn?: number }
  | { ok: false; error: "TOO_MANY" | "INVALID_EMAIL"; retryAfter?: number };

const schema = z.object({ email: z.string().trim().email().max(200) });

export async function requestCompetitorCode(input: unknown): Promise<RequestResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_EMAIL" };

  const email = parsed.data.email.toLowerCase();

  // Per address and per network, because there is no session yet to
  // throttle. Generous enough for somebody who mistypes twice, tight enough
  // that the form is not a way to enumerate a mailing list. The network MUST
  // be passed: without it every caller shares one "unknown" bucket, and five
  // requests from anyone would lock every athlete out of the code door.
  const ip = getIpFromHeaders(await headers());
  // A code went here less than a minute ago: it stays the one to type, and
  // asking again costs none of the allowance (otp.ts › code gap).
  const gap = codeGapLeft(email);
  if (gap) return { ok: true, resendIn: gap };
  const rate = limitAuthAttempt({ scope: "competitor-code", ip, identifier: email, limit: 5, networkLimit: NETWORK_LIMITS.codeRequest });
  if (!rate.ok) return { ok: false, error: "TOO_MANY", retryAfter: rate.retryAfter };

  const result = await issueCompetitorCode(email);
  // Issuing started the gap; an address that got no code starts it too.
  if (!result.ok) startCodeGap(email);

  if (result.ok) {
    await sendOtpEmail({
      email,
      code: result.code,
      ttlMinutes: getOtpConfig().ttlMinutes,
    });
  } else if (result.signup) {
    // Registered, no account, and no entry that opens this door: the way in
    // is Sign up with this same address. Said to the mailbox only.
    await sendSignUpPointerEmail({ email, url: `${getBaseUrl()}/signup` }).catch(() => undefined);
  }

  // Deliberately identical either way.
  return { ok: true };
}

/**
 * "Verify this email to see your entry" — for an athlete who is signed in
 * but whose account has not proven its current address (so no seat can be
 * linked to it). The code goes to the address ON THE ROW, read now, never the
 * session's copy; typing it proves that address and links the seats.
 */
export async function requestMyVerificationCode(): Promise<RequestResult> {
  const user = await getCurrentUser();
  if (!user || user.viewAs || user.role !== "competitor") return { ok: false, error: "INVALID_EMAIL" };

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, status: true, archivedAt: true },
  });
  if (!account || account.status === "disabled" || account.archivedAt) return { ok: false, error: "INVALID_EMAIL" };

  const ip = getIpFromHeaders(await headers());
  const gap = codeGapLeft(account.email);
  if (gap) return { ok: true, resendIn: gap };
  const rate = limitAuthAttempt({ scope: "competitor-code", ip, identifier: account.email, limit: 5, networkLimit: NETWORK_LIMITS.codeRequest });
  if (!rate.ok) return { ok: false, error: "TOO_MANY", retryAfter: rate.retryAfter };

  const { code } = await createOtpChallenge({ userId: account.id, purpose: "login", sentTo: account.email });
  await sendOtpEmail({ email: account.email, code, ttlMinutes: getOtpConfig().ttlMinutes });
  return { ok: true };
}
