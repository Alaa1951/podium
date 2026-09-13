import { NextResponse } from "next/server";

import { issueAuthToken } from "@/lib/auth-tokens";
import { sendPasswordResetEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { limitAuthAttempt } from "@/lib/rate-limit";
import { getIpFromHeaders, isValidEmail, normalizeEmail } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = getIpFromHeaders(req.headers);

  try {
    const body = (await req.json()) as { email?: string };
    const email = normalizeEmail(body.email || "");

    // The response is identical in every branch below. Callers learn nothing
    // about which addresses exist.
    if (!email || !isValidEmail(email)) return NextResponse.json({ ok: true });

    const rate = limitAuthAttempt({ scope: "forgot-password", ip, identifier: email, limit: 5 });
    if (!rate.ok) return NextResponse.json({ ok: true });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.status === "disabled") return NextResponse.json({ ok: true });

    // An invited account that never set a password gets its invitation again
    // rather than a reset link into nothing.
    const purpose = user.status === "invited" ? "invite" : "reset";
    const { url } = await issueAuthToken({ userId: user.id, purpose, req });

    if (purpose === "reset") {
      await sendPasswordResetEmail({ email, url });
    } else {
      const { sendInviteEmail } = await import("@/lib/email");
      await sendInviteEmail({
        email,
        url,
        roleLabel: user.role,
        invitedBy: "BFT MENA",
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[AUTH:forgot-password]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: true });
  }
}
