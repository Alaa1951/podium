import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * What this account looks like from the security side: the browsers it trusts
 * and the last few sign-in events. Scoped to the caller by construction — the
 * user id comes from the session, never from the request.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const [devices, events] = await Promise.all([
    prisma.trustedDevice.findMany({
      where: { userId: user.id, isRevoked: false },
      orderBy: { lastUsedAt: "desc" },
      select: {
        id: true,
        deviceLabel: true,
        browser: true,
        os: true,
        deviceType: true,
        firstSeenAt: true,
        lastUsedAt: true,
        trustExpiresAt: true,
        lastIp: true,
      },
    }),
    prisma.loginEvent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        eventType: true,
        browser: true,
        os: true,
        ip: true,
        isTrustedDevice: true,
        isSuspicious: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({ devices, events }, { headers: { "Cache-Control": "no-store" } });
}
