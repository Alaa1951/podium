import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Liveness and readiness in one call, for a load balancer or an uptime check.
 *
 * Deliberately unauthenticated and deliberately thin: it reports whether the
 * process is up and whether the database answers, and nothing else. No version
 * numbers, no counts, no configuration — a health endpoint should not be a
 * reconnaissance endpoint.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ok", database: "up", latencyMs: Date.now() - startedAt },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[HEALTH] database unreachable", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { status: "degraded", database: "down" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
