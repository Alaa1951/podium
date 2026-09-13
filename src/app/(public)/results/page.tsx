import { PublicShell } from "@/components/public/public-shell";
import { ResultsPicker } from "@/components/public/results-picker";
import { getTranslator } from "@/lib/i18n/server";
import { publishedCompetitions } from "@/lib/public-results";

export const dynamic = "force-dynamic";

/** The front door of the published results. No account, no session. */
export default async function ResultsHome() {
  const { t, locale } = await getTranslator();
  const competitions = await publishedCompetitions();

  if (competitions.length === 0) {
    return (
      <PublicShell>
        <div className="public-empty">
          <h1 className="pb-title">{t("No results yet")}</h1>
          <p>{t("Results appear here once a competition is finished and published.")}</p>
        </div>
      </PublicShell>
    );
  }

  const date = (value: Date) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
      dateStyle: "medium",
      timeZone: "Asia/Qatar",
    }).format(value);

  return (
    <PublicShell>
      <ResultsPicker
        competitions={competitions.map((one) => ({
          slug: one.slug,
          name: one.name,
          date: date(one.competitionDate),
        }))}
        initialSeries={competitions[0].slug}
      />
    </PublicShell>
  );
}
