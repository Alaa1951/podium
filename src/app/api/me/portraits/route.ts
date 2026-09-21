import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { portraitsEnabled } from "@/lib/portraits/runner";
import { MAX_UPLOAD_BYTES, queuePortrait } from "@/lib/portraits/upload";
import { prisma } from "@/lib/prisma";
import { getIpFromHeaders } from "@/lib/security";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// AN ATHLETE'S PORTRAIT UPLOADS.
//
// A ROUTE HANDLER, NOT A SERVER ACTION, and that is a size decision. Next caps
// a server action's body at 1MB by default and this project overrides nothing;
// base64 inflates a photo by a third on top of that. Multipart here is read as
// bytes, and the only limit is the explicit one below — which is the sponsor
// upload's own approach (`MAX_BYTES` in `actions/sponsors.ts`), just at a size
// a camera actually produces.
//
// EVERY METHOD IS SHUT WHEN THE FEATURE IS OFF. `PORTRAITS_ENABLED` is absent
// in production: the native shells load the live site directly, so anything
// reachable here is inside the app under store review. Off means 404 — not a
// hidden button, an absent door.
// ─────────────────────────────────────────────────────────────────────────────

const off = () => NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

/** How far along this team's portraits are — what the upload screen polls. */
export async function GET() {
  if (!portraitsEnabled()) return off();
  const user = await requireRole("competitor");

  const seat = await prisma.competitor.findFirst({
    where: { userId: user.id, team: { archivedAt: null } },
    orderBy: { team: { series: { competitionDate: "desc" } } },
    select: { teamId: true },
  });
  if (!seat) return NextResponse.json({ seats: [] });

  const seats = await prisma.competitor.findMany({
    where: { teamId: seat.teamId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      position: true,
      fullName: true,
      photoPath: true,
      portraitJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, failedReason: true },
      },
    },
  });

  return NextResponse.json({
    seats: seats.map((one) => ({
      competitorId: one.id,
      position: one.position,
      fullName: one.fullName,
      photoPath: one.photoPath,
      job: one.portraitJobs[0] ?? null,
    })),
  });
}

/** Take a photo in and queue it. */
export async function POST(request: Request) {
  if (!portraitsEnabled()) return off();
  const user = await requireRole("competitor");
  if (user.viewAs) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  // Refuse an oversized body before reading it into memory.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "TOO_LARGE" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "NO_IMAGE" }, { status: 400 });
  }

  const competitorId = String(form.get("competitorId") ?? "");
  const consent = form.get("consent") === "true";
  const photo = form.get("photo");
  if (!competitorId || !(photo instanceof Blob)) {
    return NextResponse.json({ error: "NO_IMAGE" }, { status: 400 });
  }

  const bytes = Buffer.from(await photo.arrayBuffer());
  const result = await queuePortrait({
    userId: user.id,
    competitorId,
    consent,
    bytes,
    ip: getIpFromHeaders(await headers()),
    now: new Date(),
  });

  if (!result.ok) {
    const status =
      result.error === "NOT_FOUND"
        ? 404
        : result.error === "TOO_LARGE"
          ? 413
          : result.error === "SEAT_LIMIT" || result.error === "DAILY_CAP"
            ? 429
            : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, jobId: result.jobId });
}
