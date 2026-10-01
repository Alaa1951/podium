import { NextResponse } from "next/server";

import { sendOtpEmail } from "@/lib/email";
import { canResendOtp, codeGapLeft, createOtpChallenge, getOtpConfig, startCodeGap } from "@/lib/otp";
import { prisma } from "@/lib/prisma";
import { limitAuthAttempt, NETWORK_LIMITS } from "@/lib/rate-limit";
import { getIpFromHeaders, isValidEmail, normalizeEmail } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * Re-issues the sign-in code. Answers the same way whether or not the address
 * exists, so it cannot be used to enumerate accounts:
 *
 *   { ok, cooldownSeconds }                 sent (or answered as if sent)
 *   { ok, cooldownSeconds, waiting: true }  a code went to this address less
 *                                           than the cooldown ago — nothing
 *                                           sent; the last code still works
 *   { ok, cooldownSeconds, limited: true }  too many codes asked for; nothing
 *                                           sent until the window ends
 *
 * Whether an address is waiting or limited is kept per address for known
 * and unknown addresses alike (otp.ts › code gap, rate-limit.ts).
 */
export async function POST(req: Request) {
  const ip = getIpFromHeaders(req.headers);
  const { resendCooldownSeconds } = getOtpConfig();

  try {
    const body = (await req.json()) as { email?: string };
    const email = normalizeEmail(body.email || "");

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ ok: true, cooldownSeconds: resendCooldownSeconds });
    }

    const gap = codeGapLeft(email);
    if (gap) return NextResponse.json({ ok: true, cooldownSeconds: gap, waiting: true });

    const rate = limitAuthAttempt({ scope: "resend-code", ip, identifier: email, limit: 5, networkLimit: NETWORK_LIMITS.emailedLink });
    if (!rate.ok) {
      return NextResponse.json(
        { ok: true, cooldownSeconds: rate.retryAfter, limited: true },
        { headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== "active") {
      startCodeGap(email);
      return NextResponse.json({ ok: true, cooldownSeconds: resendCooldownSeconds });
    }

    // After a restart the gap above is empty: the last code's own time still counts.
    const resend = await canResendOtp({ userId: user.id, purpose: "login" });
    if (!resend.allowed) {
      return NextResponse.json({ ok: true, cooldownSeconds: resend.cooldownSeconds, waiting: true });
    }

    const { code } = await createOtpChallenge({ userId: user.id, purpose: "login", sentTo: user.email, ip });
    await sendOtpEmail({ email, code, ttlMinutes: getOtpConfig().ttlMinutes });

    return NextResponse.json({ ok: true, cooldownSeconds: resendCooldownSeconds });
  } catch (error) {
    console.error("[AUTH:resend-code]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: true, cooldownSeconds: resendCooldownSeconds });
  }
}
