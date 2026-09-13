import { NextResponse } from "next/server";

import { AUDIT, recordAudit } from "@/lib/audit";
import { sendSecurityAlertEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Drops a trusted browser — one, or all of them. `userId` is part of the update
 * filter, so a guessed device id belonging to somebody else matches nothing.
 * Revoking everything also forces a code on this account's next sign-in.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { deviceId?: string; all?: boolean };
  const all = body.all === true;
  const deviceId = (body.deviceId || "").trim();

  if (!all && !deviceId) {
    return NextResponse.json({ ok: false, error: "DEVICE_REQUIRED" }, { status: 400 });
  }

  const result = await prisma.trustedDevice.updateMany({
    where: {
      userId: user.id,
      isRevoked: false,
      ...(all ? {} : { id: deviceId }),
    },
    data: {
      isTrusted: false,
      isRevoked: true,
      revokedAt: new Date(),
      revokeReason: all ? "user_revoked_all" : "user_revoked",
    },
  });

  if (all) {
    await prisma.user.update({
      where: { id: user.id },
      data: { forceOtpNextLogin: true },
    });
  }

  if (result.count > 0) {
    await recordAudit({
      actorId: user.id,
      action: AUDIT.devicesRevoked,
      targetType: "user",
      targetId: user.id,
      targetLabel: user.email,
      detail: all ? "all devices" : `device ${deviceId}`,
    });

    await sendSecurityAlertEmail({
      email: user.email,
      subject: all ? "All trusted devices removed" : "A trusted device was removed",
      details: [`Time: ${new Date().toISOString()}`],
    }).catch(() => {
      // The device is already untrusted; a failed notice must not undo that.
    });
  }

  return NextResponse.json({ ok: true, revoked: result.count });
}
