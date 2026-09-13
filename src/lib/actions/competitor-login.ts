"use server";

import { z } from "zod";

import { sendOtpEmail } from "@/lib/email";
import { getOtpConfig } from "@/lib/otp";
import { issueCompetitorCode } from "@/lib/competitor-access";
import { limitAuthAttempt } from "@/lib/rate-limit";

/**
 * Asking for a competitor sign-in code.
 *
 * The answer is always the same sentence. Whether an address competed in
 * PODIUM is not something a stranger gets to find out by typing addresses into
 * a form, so there is no "we don't know that email" to read.
 */
export type RequestResult = { ok: true } | { ok: false; error: "TOO_MANY" | "INVALID_EMAIL" };

const schema = z.object({ email: z.string().trim().email().max(200) });

export async function requestCompetitorCode(input: unknown): Promise<RequestResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_EMAIL" };

  const email = parsed.data.email.toLowerCase();

  // Per address, because there is no session yet to throttle. Generous enough
  // for somebody who mistypes twice, tight enough that the form is not a way
  // to enumerate a mailing list.
  const rate = limitAuthAttempt({ scope: "competitor-code", identifier: email, limit: 5 });
  if (!rate.ok) return { ok: false, error: "TOO_MANY" };

  const result = await issueCompetitorCode(email);

  if (result.ok) {
    await sendOtpEmail({
      email,
      code: result.code,
      ttlMinutes: getOtpConfig().ttlMinutes,
    });
  }

  // Deliberately identical either way.
  return { ok: true };
}
