import Link from "next/link";

import { ArchivedSeriesStrip } from "@/components/admin/series-archive";
import { getTranslator } from "@/lib/i18n/server";
import { listArchivedSeries, listSeries } from "@/lib/queries";
import { can, requireAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Every PODIUM, soonest first. One card is one competition. */
export default async function CompetitionsPage() {
  const user = await requireAccess("competitions.view");
  const { t, locale } = await getTranslator();

  const [competitions, archived] = await Promise.all([
    listSeries(),
    listArchivedSeries(),
  ]);

  const day = (date: Date) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
      dateStyle: "full",
      timeZone: "Asia/Qatar",
    }).format(date);

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Competitions")}</h1>
          <p>
            {t(
              "Each one has its own field, its own running order and its own scoring definition. Open one to work inside it."
            )}
          </p>
        </div>
        {can(user, "competitions.create") && !user.viewAs ? (
          <div className="screen-head-actions">
            <Link href="/series/new" className="btn btn-primary">
              {t("New competition")}
            </Link>
          </div>
        ) : null}
      </div>

      {competitions.length === 0 ? (
        <div className="notice">
          <strong>{t("No competitions yet.")}</strong>{" "}
          {t("Create one, choose the studios taking part, and the rest follows.")}
        </div>
      ) : (
        <div className="series-grid">
          {competitions.map((one) => (
            <Link key={one.id} href={`/series/${one.slug}`} className="series-card">
              <div className="series-card-top">
                <span
                  className={`badge ${one.status === "live" ? "badge-live" : one.status === "final" ? "badge-ok" : "badge-neutral"}`}
                >
                  {one.status === "live"
                    ? t("Running now")
                    : one.status === "final"
                      ? t("Finished")
                      : t("Upcoming")}
                </span>
              </div>
              <div className="series-card-name">{one.name}</div>
              <div className="series-card-date">{day(one.competitionDate)}</div>
              <div className="series-card-venue">{one.venue}</div>

              <dl className="series-card-figures">
                <div>
                  <dt>{t("Teams")}</dt>
                  <dd className="pd-num">{one._count.teams}</dd>
                </div>
                <div>
                  <dt>{t("Waves")}</dt>
                  <dd className="pd-num">{one._count.waves}</dd>
                </div>
                <div>
                  <dt>{t("Studios")}</dt>
                  <dd className="pd-num">{one._count.studios}</dd>
                </div>
                <div>
                  <dt>{t("Zones")}</dt>
                  <dd className="pd-num" data-warn={one._count.zones === 0 || undefined}>
                    {one._count.zones}
                  </dd>
                </div>
              </dl>

              {one._count.zones === 0 ? (
                <div className="series-card-warn">
                  {t("No scoring definition yet — scores cannot be entered.")}
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}

      <ArchivedSeriesStrip
        archived={archived.map((one) => ({
          id: one.id,
          name: one.name,
          slug: one.slug,
          archivedAt: one.archivedAt?.toISOString().slice(0, 10) ?? "",
        }))}
      />
    </div>
  );
}
