import { notFound } from "next/navigation";

import { PublicResultsBoard } from "@/components/public/results-board";
import { SponsorStrip } from "@/components/board/sponsor-strip";
import { PublicShell } from "@/components/public/public-shell";
import { getTranslator } from "@/lib/i18n/server";
import { publishedBoardView } from "@/lib/public-results";
import { CATEGORIES, DIVISIONS } from "@/lib/scoring";
import type { Category, Division } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

/** One bracket of a published competition. */
export default async function PublicBoardPage(
  props: PageProps<"/results/[series]/[category]/[division]">
) {
  const { series, category, division } = await props.params;
  const { t } = await getTranslator();

  // The bracket comes out of the URL, so it is checked rather than trusted.
  if (!CATEGORIES.includes(category as Category)) notFound();
  if (!DIVISIONS.includes(division as Division)) notFound();

  const view = await publishedBoardView(series, category as Category, division as Division);
  if (!view) notFound();

  return (
    <PublicShell back={{ href: "/results", label: t("Back") }}>
      <PublicResultsBoard
        rows={view.rows}
        studios={view.studios}
        category={category}
        division={division}
        seriesName={view.seriesName}
        seriesSlug={view.seriesSlug}
        showCompetitorNames={view.showCompetitorNames}
        showStudioColumn={view.showStudioColumn}
      />

      <SponsorStrip enabled={view.sponsorsEnabled} logos={view.sponsors} />
    </PublicShell>
  );
}
