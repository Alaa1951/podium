import "server-only";

import { notFound, redirect } from "next/navigation";

import type { CurrentUser } from "@/lib/access";
import { getSeriesState } from "@/lib/series-state";
import { homeForUser, requireUser } from "@/lib/session";
import { getStudioSeriesBySlug } from "@/lib/studio-queries";

/**
 * WHO IS AT THE DESK, AND IN WHICH COMPETITION — for the check-in screens,
 * which exist twice: in the competition console (BFT MENA and event staff,
 * every team) and in a gym's own area (its own teams only).
 *
 * `allowed` is the screen's own rule from access.ts. A judge, a coach or
 * anybody else without the key is sent to where they belong; an athlete's
 * account never reaches either. A gym is told nothing about a competition it
 * is not taking part in (404, the same as the rest of its area).
 *
 * What the desk then SEES is `teamScope(user)` — this only opens the door.
 */
export type DeskArea = "console" | "studio";

export async function requireDesk(
  params: Promise<{ series: string }>,
  area: DeskArea,
  allowed: (user: CurrentUser) => boolean
): Promise<{ user: CurrentUser; series: { id: string; slug: string; name: string; status: "scheduled" | "live" | "final" } }> {
  const user = await requireUser();
  const belongsHere = area === "studio" ? user.role === "studio" : user.role !== "studio" && user.role !== "competitor";
  if (!belongsHere || !allowed(user)) redirect(await homeForUser(user));

  const { series: slug } = await params;
  if (area === "studio") {
    const series = await getStudioSeriesBySlug(user, slug);
    if (!series) notFound();
    return { user, series: { id: series.id, slug: series.slug, name: series.name, status: series.status } };
  }
  const state = await getSeriesState(slug);
  if (!state) notFound();
  const { series } = state;
  return { user, series: { id: series.id, slug: series.slug, name: series.name, status: series.status } };
}
