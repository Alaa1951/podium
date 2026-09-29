import { NextResponse } from "next/server";

import { AUDIT, recordAudit } from "@/lib/audit";
import { issueAuthToken } from "@/lib/auth-tokens";
import { sendPasswordResetEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { limitAuthAttempt } from "@/lib/rate-limit";
import { getIpFromHeaders } from "@/lib/security";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * "Change my password", from inside a session — by email, like a forgotten
 * one. No current password is asked for, whoever is asking: proving the
 * mailbox is a higher bar than proving a laptop was left unlocked, and it is
 * the same bar the account holder would clear if they had simply forgotten.
 *
 * The address is the session's own, never a parameter — a signed-in person
 * cannot aim this at somebody else's inbox. Spending the link revokes every
 * trusted device (set-password/route.ts), so each browser is asked for a code
 * at its next sign-in. Sessions already open are JWTs and run to expiry.
 * An account with no password (a code-only athlete) uses the same link to
 * create one.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  // A "View as" preview is read-only: no reset mail to the previewed person.
  if (user.viewAs) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

  const ip = getIpFromHeaders(req.headers);
  const rate = limitAuthAttempt({ scope: "request-password-reset", ip, identifier: user.email, limit: 5 });
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "TOO_MANY_ATTEMPTS" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  try {
    // The session's address is not trusted for the link: the row's is read
    // fresh, so a change made elsewhere is what the link goes to and proves.
    const account = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, status: true, archivedAt: true } });
    if (!account || account.status === "disabled" || account.archivedAt) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
    const { url } = await issueAuthToken({ userId: user.id, purpose: "reset", sentTo: account.email, req });
    await sendPasswordResetEmail({ email: account.email, url });
  } catch (error) {
    // Never surface mail internals; the caller only learns it did not go.
    console.error("[AUTH:request-password-reset]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "EMAIL_SEND_FAILED" }, { status: 502 });
  }

  await recordAudit({
    actorId: user.id,
    action: AUDIT.passwordResetRequested,
    targetType: "user",
    targetId: user.id,
    targetLabel: user.email,
  });

  return NextResponse.json({ ok: true });
}
