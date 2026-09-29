import { NextResponse } from "next/server";

import { consumeAuthToken } from "@/lib/auth-tokens";
import { sendSecurityAlertEmail } from "@/lib/email";
import { linkSeatsForUser } from "@/lib/link-seats";
import { prisma } from "@/lib/prisma";
import { limitAuthAttempt, NETWORK_LIMITS } from "@/lib/rate-limit";
import { checkPasswordStrength, getIpFromHeaders, hashPassword } from "@/lib/security";
import { revokeTrustedDevices } from "@/lib/trusted-device";

export const dynamic = "force-dynamic";

/**
 * Sets a first password (invitation) or replaces one (reset). The link is
 * spent, the address it went to is proven and the password is written in ONE
 * transaction, under the account's row lock (auth-proof.ts): a link sent to
 * an address the account no longer has does nothing at all — no password, no
 * activation, no proof — and the person is told to ask for a new one.
 * Success drops every trusted device and forces a code on the next sign-in,
 * so a stolen link cannot leave a quiet session behind.
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

    const rate = limitAuthAttempt({ scope: "set-password", ip, limit: 10, networkLimit: NETWORK_LIMITS.emailedLink });
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

    const passwordHash = await hashPassword(password);

    const result = await consumeAuthToken({
      token,
      purpose,
      apply: async (tx, user) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash,
            status: "active",
            // The next sign-in is challenged even from this browser: setting a
            // password proves possession of a mailbox, not of a device.
            forceOtpNextLogin: true,
          },
        });
      },
    });

    if (!result.ok) {
      // A right link to the wrong address is a refusal the person can act
      // on; every other failure looks like an expired link, as before.
      const error = result.reason === "address_changed" || result.reason === "no_recipient" ? "LINK_REFUSED" : "INVALID_TOKEN";
      return NextResponse.json({ ok: false, error }, { status: 400 });
    }

    // The mailbox is proven and committed: an athlete's seats follow, in a
    // transaction of their own (a failed link never undoes the password).
    if (result.user.role === "competitor") await linkSeatsForUser(prisma, result.user.id);

    await revokeTrustedDevices({ userId: result.user.id, reason: "password_changed" });

    await sendSecurityAlertEmail({
      email: result.user.email,
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
