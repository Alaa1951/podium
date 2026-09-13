import { NextResponse } from "next/server";

import { publishedBoardView } from "@/lib/public-results";
import { CATEGORIES, DIVISIONS } from "@/lib/scoring";
import type { Category, Division } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

/**
 * The public leaderboard's poll — the published-data twin of the console's
 * board endpoint. Same view the page renders, and nothing else: only a FINAL,
 * explicitly published competition, only paid and submitted teams, only the
 * fields the page shows. Anybody may read it because everybody may read the
 * page; there is simply nothing more in here.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/results/[series]/[category]/[division]">
) {
  const { series, category, division } = await ctx.params;

  if (!CATEGORIES.includes(category as Category) || !DIVISIONS.includes(division as Division)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const view = await publishedBoardView(series, category as Category, division as Division);
  if (!view) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json(view, {
    headers: { "Cache-Control": "no-store" },
  });
}
