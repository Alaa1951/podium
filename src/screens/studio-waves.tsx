import { DetailLink } from "@/components/app/detail-link";
import type { SeriesScreenProps } from "@/screens/types";
import { notFound } from "next/navigation";

import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { getSeriesWaves } from "@/lib/queries";
import { getStudioSeriesBySlug } from "@/lib/studio-queries";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * THE RUNNING ORDER, AS THIS STUDIO SEES IT.
 *
 * When every wave runs, how long it has, where it stands — and which of this
 * studio's own pairs are in each. Read-only by design: the clock and the floor
 * are BFT MENA's to run; the studio's job is knowing where its teams stand.
 */
export default async function StudioWavesPage(
  props: SeriesScreenProps, detailId?: string
) {
  const user = await requireRole("studio");
  const { t } = await getTranslator();

  const { series: slug } = await props.params;
  const series = await getStudioSeriesBySlug(user, slug);
  if (!series) notFound();

  const [waves, teams] = await Promise.all([
    getSeriesWaves(series.id),
    prisma.team.findMany({
      where: {
        seriesId: series.id,
        studioId: user.studioId ?? "__none__",
        archivedAt: null,
      },
      select: { id: true, name: true, number: true, wave: true, paymentStatus: true },
      orderBy: { number: "asc" },
    }),
  ]);

  const statusLabel = (status: string) =>
    status === "running"
      ? t("Running now")
      : status === "complete"
        ? t("Finished")
        : t("Upcoming");

  const unassigned = teams.filter((team) => !team.wave);

  if(detailId && !waves.some(wave=>wave.id===detailId)) notFound();
  if(detailId){const wave=waves.find(wave=>wave.id===detailId)!;return <div className="screen mobile-detail"><h1>{t("Wave")} {wave.number}</h1><dl><dt>{t("Estimated start")}</dt><dd>{wave.startTime}</dd><dt>{t("Status")}</dt><dd>{statusLabel(wave.status)}</dd></dl><h2>{t("Your teams")}</h2>{teams.filter(team=>team.wave===wave.number).map(team=><DetailLink key={team.id} href={`/studio/${slug}/teams/${team.id}`}><strong>{team.number}. {team.name}</strong></DetailLink>)}</div>;}
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Waves")}</h1>
          <p>
            {t(
              "When each wave runs and which of your pairs are in it. The clock itself is run by BFT MENA."
            )}
          </p>
        </div>
      </div>

      <div className="mobile-only mobile-list">{waves.map(wave=><DetailLink key={wave.id} href={`/studio/${slug}/waves/${wave.id}`}><strong>{t("Wave")} {wave.number}</strong><span>{wave.startTime} · {statusLabel(wave.status)}</span></DetailLink>)}</div>
      <div className="table-scroll desktop-only">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 80 }}>{t("Wave")}</th>
              <th style={{ width: 130 }}>{t("Estimated start")}</th>
              <th style={{ width: 130 }}>{t("Status")}</th>
              <th style={{ width: 90 }}>{t("Pairs")}</th>
              <th>{t("Your teams")}</th>
            </tr>
          </thead>
          <tbody>
            {waves.map((wave) => {
              const mine = teams.filter((team) => team.wave === wave.number);
              return (
                <tr key={wave.id}>
                  <td className="pd-num">{wave.number}</td>
                  <td className="pd-num">{wave.startTime}</td>
                  <td>
                    <span
                      className={`badge ${
                        wave.status === "running"
                          ? "badge-live"
                          : wave.status === "complete"
                            ? "badge-ok"
                            : "badge-neutral"
                      }`}
                    >
                      {statusLabel(wave.status)}
                    </span>
                  </td>
                  <td className="pd-num">{wave.teamCount}</td>
                  <td>
                    {mine.length ? (
                      <div className="reg-person">
                        {mine.map((team) => (
                          <span key={team.id} className="pd-num">
                            {team.number}. {team.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="reg-sub">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {unassigned.length > 0 ? (
        <div className="notice" style={{ marginTop: 14 }}>
          <strong>{t("Not in a wave yet:")}</strong>{" "}
          {unassigned
            .map((team) => `${team.number}. ${team.name}`)
            .join(" · ")}
        </div>
      ) : null}
    </div>
  );
}
