import "server-only";

import { notFound } from "next/navigation";

import { getSeriesState, type SeriesState } from "@/lib/series-state";

/**
 * The competition a page is about, from the slug in its URL.
 *
 * Every screen inside a competition starts here, so "which competition" is
 * answered in exactly one place and a bad slug is a 404 rather than a page
 * that renders someone else's numbers.
 */
export async function requireSeries(param: Promise<{ series: string }>): Promise<SeriesState> {
  const { series } = await param;
  const state = await getSeriesState(series);
  if (!state) notFound();
  return state;
}

/** Links between sections of the same competition. */
export function seriesHref(slug: string, section = "") {
  return section ? `/series/${slug}/${section}` : `/series/${slug}`;
}
