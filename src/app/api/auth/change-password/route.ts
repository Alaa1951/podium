import { NextResponse } from "next/server";

import { AUDIT, recordAudit } from "@/lib/audit";
import { sendSecurityAlertEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { limitAuthAttempt } from "@/lib/rate-limit";
import {
  checkPasswordStrength,
  getIpFromHeaders,
  hashPassword,
  verifyPassword,
} from "@/lib/security";
import { revokeTrustedDevices } from "@/lib/trusted-device";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Changing a password from inside a session still requires the current one — a
 * borrowed unlocked laptop must not be enough to take the account over. On
 * success every trusted device is dropped and the next sign-in is challenged.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });

  const ip = getIpFromHeaders(req.headers);
  const rate = limitAuthAttempt({ scope: "change-password", ip, identifier: user.email, limit: 5 });
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "TOO_MANY_ATTEMPTS" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  };

  const currentPassword = body.currentPassword || "";
  const newPassword = body.newPassword || "";
  const confirmPassword = body.confirmPassword || "";

  if (newPassword !== confirmPassword) {
    return NextResponse.json({ ok: false, error: "PASSWORDS_DO_NOT_MATCH" }, { status: 400 });
  }

  const strength = checkPasswordStrength(newPassword);
  if (!strength.ok) return NextResponse.json({ ok: false, error: strength.reason }, { status: 400 });

  const record = await prisma.user.findUnique({ where: { id: user.id } });
  if (!record?.passwordHash) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const valid = await verifyPassword(currentPassword, record.passwordHash);
  if (!valid) {
    return NextResponse.json({ ok: false, error: "CURRENT_PASSWORD_WRONG" }, { status: 400 });
  }

  // Reusing the same password would leave every trusted device revoked for no
  // gain, and tells the user nothing changed.
  if (await verifyPassword(newPassword, record.passwordHash)) {
    return NextResponse.json({ ok: false, error: "PASSWORD_UNCHANGED" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), forceOtpNextLogin: true },
  });

  await revokeTrustedDevices({ userId: user.id, reason: "password_changed" });

  await recordAudit({
    actorId: user.id,
    action: AUDIT.passwordChanged,
    targetType: "user",
    targetId: user.id,
    targetLabel: user.email,
  });

  await sendSecurityAlertEmail({
    email: user.email,
    subject: "Password changed",
    details: [`Time: ${new Date().toISOString()}`, ip ? `IP: ${ip}` : "IP: unknown"],
  }).catch(() => {
    // Already changed; a failed notice must not roll it back.
  });

  return NextResponse.json({ ok: true });
}
