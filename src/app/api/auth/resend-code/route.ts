import { NextResponse } from "next/server";

import { sendOtpEmail } from "@/lib/email";
import { canResendOtp, createOtpChallenge, getOtpConfig } from "@/lib/otp";
import { prisma } from "@/lib/prisma";
import { limitAuthAttempt } from "@/lib/rate-limit";
import { getIpFromHeaders, isValidEmail, normalizeEmail } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * Re-issues the sign-in code. Answers the same way whether or not the address
 * exists, so it cannot be used to enumerate accounts.
 */
export async function POST(req: Request) {
  const ip = getIpFromHeaders(req.headers);

  try {
    const body = (await req.json()) as { email?: string };
    const email = normalizeEmail(body.email || "");

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ ok: true, cooldownSeconds: 60 });
    }

    const rate = limitAuthAttempt({ scope: "resend-code", ip, identifier: email, limit: 5 });
    if (!rate.ok) {
      return NextResponse.json(
        { ok: true, cooldownSeconds: rate.retryAfter },
        { headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== "active") {
      return NextResponse.json({ ok: true, cooldownSeconds: 60 });
    }

    const resend = await canResendOtp({ userId: user.id, purpose: "login" });
    if (!resend.allowed) {
      return NextResponse.json({ ok: true, cooldownSeconds: resend.cooldownSeconds });
    }

    const { code } = await createOtpChallenge({ userId: user.id, purpose: "login", ip });
    await sendOtpEmail({ email, code, ttlMinutes: getOtpConfig().ttlMinutes });

    return NextResponse.json({
      ok: true,
      cooldownSeconds: getOtpConfig().resendCooldownSeconds,
    });
  } catch (error) {
    console.error("[AUTH:resend-code]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: true, cooldownSeconds: 60 });
  }
}
