import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

// SPONSOR LOGO BYTES.
//
// Public read, deliberately: the artwork renders on wall boards and published
// results — screens that by definition run without a session. A sponsor's
// logo is marketing material, the same image the sponsor hands out to be
// shown; knowing a cuid is the only requirement, and cuids appear only on
// admin surfaces and published pages. Nothing enumerable, nothing sensitive.
export async function GET(_req: Request, ctx: RouteContext<"/api/sponsors/[id]/logo">) {
  const { id } = await ctx.params;

  const sponsor = await prisma.sponsor.findUnique({
    where: { id },
    select: { imageB64: true, mimeType: true },
  });
  if (!sponsor) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const bytes = Buffer.from(sponsor.imageB64, "base64");

  // A logo changes only by replacing the row (a new cuid with it), so the URL
  // itself is the cache key — caches may hold it for a year.
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": sponsor.mimeType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
