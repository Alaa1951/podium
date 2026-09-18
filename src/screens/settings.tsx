import { notFound } from "next/navigation";
import type { SeriesScreenProps } from "@/screens/types";
import Link from "next/link";

import { SettingsForm, type SeriesSettings } from "@/components/series/settings-form";
import { ZoneEditor } from "@/components/admin/zone-editor";
import { SponsorEditor } from "@/components/admin/sponsor-editor";
import { ArchiveSeriesButton } from "@/components/admin/series-archive";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { getSeriesZones } from "@/lib/queries";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { requireRole, requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/** A datetime-local input wants "YYYY-MM-DDTHH:mm" and nothing else. */
function forInput(date: Date | null) {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/**
 * EVERY SETTING THIS COMPETITION HAS.
 *
 * Including the one that used to be code: what a zone is, what is measured at
 * it, and what a unit of it is worth. Each competition owns its own, so Series
 * 2 is allowed to be a different sport from Series 1.
 */
export default async function SettingsPage(props: SeriesScreenProps, zoneId?: string, zoneEdit = false) {
  const user = await requirePermission("settings.view");
  if(zoneEdit) await requireRole("admin");
  const { t } = await getTranslator();

  const { series } = await requireSeries(props.params);

  const [zones, recorded, sponsors] = await Promise.all([
    getSeriesZones(series.id),
    prisma.zoneEntry.count({
      where: { input: { zone: { seriesId: series.id } }, value: { not: null } },
    }),
    prisma.sponsor.findMany({
      where: { seriesId: series.id },
      orderBy: { position: "asc" },
      select: { id: true, alt: true, position: true },
    }),
  ]);

  if(zoneId && zoneId !== "new" && zoneId !== "list" && !zones.some(zone => zone.id === zoneId)) notFound();
  if(zoneId) return <div className="screen"><div className="screen-head"><h1>{t("Zones")}</h1></div><ZoneEditor seriesId={series.id} seriesName={t("Zones")} zones={zones} recordedValues={recorded} detailId={zoneId === "list" ? undefined : zoneId} editMode={zoneEdit} readOnly={user.role !== "admin" || !!user.viewAs} /></div>;

  const initial: SeriesSettings = {
    id: series.id,
    slug: series.slug,
    name: series.name,
    competitionDate: forInput(series.competitionDate),
    venue: series.venue,
    status: series.status,
    firstWaveTime: series.firstWaveTime,
    waveMinutes: series.waveMinutes,
    waveCapacity: series.waveCapacity,
    boardOpensAt: forInput(series.boardOpensAt),
    registrationClosesAt: forInput(series.registrationClosesAt),
    registrationsFinalAt: forInput(series.registrationsFinalAt),
    scoreEntryClosesAt: forInput(series.scoreEntryClosesAt),
    resultsPublicAt: forInput(series.resultsPublicAt),
    championsAnnouncedAt: forInput(series.championsAnnouncedAt),
    studiosMayEnterScores: series.studiosMayEnterScores,
    studioScoreCorrections: series.studioScoreCorrections,
    teamEditCloseHours: series.teamEditCloseHours,
    showTeamName: series.showTeamName,
    showCompetitorNames: series.showCompetitorNames,
    showStudioColumn: series.showStudioColumn,
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Settings")}</h1>
          <p>{t("Everything about this competition that is a choice rather than a fact.")}</p>
        </div>
      </div>

      <SettingsForm initial={initial} />

      <h2 className="section-title" style={{ marginTop: 34 }}>
        {t("Scoring")}
      </h2>
      <p className="reg-sub" style={{ marginTop: 4, marginBottom: 14, maxWidth: "70ch" }}>
        {t(
          "How a score becomes points, here. A movement's points are its value multiplied and then divided — which is how a person says it out loud, and how the arithmetic stays exact."
        )}
      </p>

      <ZoneEditor
        seriesId={series.id}
        seriesName={t("Zones")}
        zones={zones}
        recordedValues={recorded}
        readOnly={user.role !== "admin" || !!user.viewAs}
      />

      <h2 className="section-title" style={{ marginTop: 34 }}>
        {t("Sponsors")}
      </h2>
      <p className="reg-sub" style={{ marginTop: 4, marginBottom: 14, maxWidth: "70ch" }}>
        {t(
          "Each competition carries its own sponsor rail — ten slots on the wall board and the published results. Logos are stored with the event, so a backup carries them too."
        )}
      </p>

      <SponsorEditor
        seriesId={series.id}
        sponsors={sponsors}
        enabled={series.sponsorsEnabled}
      />

      <h2 className="section-title" style={{ marginTop: 34 }}>
        {t("Archive")}
      </h2>
      <p className="reg-sub" style={{ marginTop: 4, marginBottom: 14, maxWidth: "70ch" }}>
        {t(
          "Only a competition that has not started can be archived. It leaves the list but stays restorable — nothing on it is deleted."
        )}
      </p>
      <ArchiveSeriesButton seriesId={series.id} />

      <div className="notice" style={{ marginTop: 30 }}>
        <strong>{t("Waves and wave access.")}</strong>{" "}
        {t(
          "Assign teams to their waves from the Waves screen; grant an account the score sheet of one wave from Score entry."
        )}{" "}
        <Link href={seriesHref(series.slug, "waves")} className="linkish">
          {t("Waves")} →
        </Link>{" "}
        <Link href={seriesHref(series.slug, "scores")} className="linkish">
          {t("Score entry")} →
        </Link>
      </div>
    </div>
  );
}
