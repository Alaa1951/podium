import Link from "next/link";
import { redirect } from "next/navigation";

import { PlainHeader } from "@/components/app/plain-header";
import { getTranslator } from "@/lib/i18n/server";
import { requireRole } from "@/lib/session";
import { getStudioSeries } from "@/lib/studio-queries";

export const dynamic = "force-dynamic";

/**
 * WHERE A STUDIO LANDS.
 *
 * A studio may be entered in several competitions at once, so this is the
 * choice of which one — and with only one to choose from it is not a choice at
 * all, so it goes straight there.
 */
export default async function StudioHome() {
  const user = await requireRole("studio");
  const { t, locale } = await getTranslator();

  const series = await getStudioSeries(user);
  if (series.length === 1) redirect(`/studio/${series[0].slug}/teams`);

  const date = (value: Date) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Qatar",
    }).format(value);

  return (
    <div className="screen">
      <PlainHeader roleLabel={user.name ?? t("Studio")} />

      <div className="screen-head">
        <div>
          <h1>{t("Your competitions")}</h1>
          <p>{t("The PODIUM competitions your studio is entered in.")}</p>
        </div>
      </div>

      {series.length === 0 ? (
        <div className="notice">
          <strong>{t("Nothing yet.")}</strong>{" "}
          {t("BFT MENA adds your studio to a competition before you can register teams for it.")}
        </div>
      ) : (
        <div className="series-grid">
          {series.map((row) => (
            <Link key={row.id} href={`/studio/${row.slug}/teams`} className="series-card">
              <div className="series-card-top">
                <span className="badge badge-neutral">
                  {row.teamCount} {t("teams")}
                </span>
              </div>
              <div className="series-card-name">{row.name}</div>
              <div className="series-card-date">{date(row.competitionDate)}</div>
              {row.venue ? <div className="series-card-venue">{row.venue}</div> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
