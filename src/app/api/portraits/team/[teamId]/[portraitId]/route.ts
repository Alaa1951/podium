import { NextResponse } from "next/server";

import { portraitsEnabled } from "@/lib/portraits/runner";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// THE TEAM COMPOSITE'S BYTES. Same rules as the single portrait beside it.
//
// SIGNED IN ONLY, unlike the sponsor-logo route beside it. A sponsor's mark is
// marketing material the sponsor hands out; a person's face is not, so this is
// deliberately absent from `PUBLIC_PATHS`. The rig screens already run under a
// session, so nothing is lost by it.
//
// Both ids are in the WHERE, not just the trailing one: a stale `photoPath`
// cannot be pointed at another competitor's row by editing the URL.
//
// `private` rather than `public` for the same reason — this response is
// per-session and must not sit in a shared cache. `immutable` is still true:
// a regenerate mints a new portrait id, so these exact bytes never change.
export async function GET(_req: Request, ctx: RouteContext<"/api/portraits/team/[teamId]/[portraitId]">) {
  if (!portraitsEnabled()) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  await requireUser();

  const { teamId, portraitId } = await ctx.params;
  const portrait = await prisma.teamPortrait.findFirst({
    where: { id: portraitId, teamId },
    select: { imageB64: true, mimeType: true },
  });
  if (!portrait) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const bytes = Buffer.from(portrait.imageB64, "base64");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": portrait.mimeType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
