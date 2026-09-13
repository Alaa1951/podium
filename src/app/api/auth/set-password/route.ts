import { NextResponse } from "next/server";

import { consumeAuthToken } from "@/lib/auth-tokens";
import { sendSecurityAlertEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { limitAuthAttempt } from "@/lib/rate-limit";
import { checkPasswordStrength, getIpFromHeaders, hashPassword } from "@/lib/security";
import { revokeTrustedDevices } from "@/lib/trusted-device";

export const dynamic = "force-dynamic";

/**
 * Sets a first password (invitation) or replaces one (reset). Both spend the
 * one-time token, drop every trusted device, and force a code on the next
 * sign-in — so a stolen link cannot leave a quiet session behind.
 */
export async function POST(req: Request) {
  const ip = getIpFromHeaders(req.headers);

  try {
    const body = (await req.json()) as {
      token?: string;
      purpose?: string;
      password?: string;
      confirmPassword?: string;
    };

    const token = (body.token || "").trim();
    const purpose = body.purpose === "invite" ? "invite" : "reset";
    const password = body.password || "";
    const confirmPassword = body.confirmPassword || "";

    const rate = limitAuthAttempt({ scope: "set-password", ip, limit: 10 });
    if (!rate.ok) {
      return NextResponse.json(
        { ok: false, error: "TOO_MANY_ATTEMPTS" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }

    if (!token) return NextResponse.json({ ok: false, error: "INVALID_TOKEN" }, { status: 400 });
    if (password !== confirmPassword) {
      return NextResponse.json({ ok: false, error: "PASSWORDS_DO_NOT_MATCH" }, { status: 400 });
    }

    const strength = checkPasswordStrength(password);
    if (!strength.ok) {
      return NextResponse.json({ ok: false, error: strength.reason }, { status: 400 });
    }

    const record = await consumeAuthToken({ token, purpose });
    if (!record) return NextResponse.json({ ok: false, error: "INVALID_TOKEN" }, { status: 400 });

    const passwordHash = await hashPassword(password);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          status: "active",
          emailVerified: record.user.emailVerified ?? new Date(),
          // The next sign-in is challenged even from this browser: setting a
          // password proves possession of a mailbox, not of a device.
          forceOtpNextLogin: true,
        },
      }),
      prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);

    await revokeTrustedDevices({ userId: record.userId, reason: "password_changed" });

    await sendSecurityAlertEmail({
      email: record.user.email,
      subject: purpose === "invite" ? "Your account is active" : "Password changed",
      details: [`Time: ${new Date().toISOString()}`],
    }).catch(() => {
      // The password is already set; a failed notification must not undo it.
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[AUTH:set-password]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
