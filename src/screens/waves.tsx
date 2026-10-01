import { notFound } from "next/navigation";
import type { SeriesScreenProps } from "@/screens/types";
import { WaveBoard } from "@/components/setup/wave-board";
import { getTranslator } from "@/lib/i18n/server";
import { getScopedRoster, getSeriesStudios } from "@/lib/queries";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { can, requireConsoleAccess } from "@/lib/session";
import { canBuildSchedule, canPlaceTeams } from "@/lib/access";
import { loadScheduleView } from "@/lib/schedule-view";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * THE RUNNING ORDER.
 *
 * Which teams run together, and when. A wave carries its own estimated start;
 * its length and capacity come from the competition settings. STARTING one is
 * the operator's job and lives next to the scores, where they will be standing.
 */
export default async function WavesPage(props: SeriesScreenProps, detailId?: string, editMode = false) {
  const user = await requireConsoleAccess(editMode ? "waves.edit" : "waves.view");
  const { t } = await getTranslator();

  const { series, waves } = await requireSeries(props.params);
  const [teams, studios, schedule, scoredRows] = await Promise.all([
    getScopedRoster(series.id, user),
    getSeriesStudios(series.id),
    loadScheduleView(series.id),
    // A submitted zone makes a team's slot final (actions/team-slot.ts).
    prisma.zoneScore.findMany({ where: { status: "submitted", score: { team: { seriesId: series.id } } }, select: { score: { select: { teamId: true } } } }),
  ]);
  const scored = new Set(scoredRows.map((row) => row.score.teamId));

  if (detailId && !waves.some(wave => wave.id === detailId)) notFound();
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Waves")}</h1>
          <p>
            {t(
              "The floor holds nine teams at once, one per station, so the field is dealt into waves. Each team keeps its station in every zone. Each category runs in its own block of the day (Settings → Category schedule); each wave carries its own estimated start."
            )}
          </p>
        </div>
      </div>

      <WaveBoard
        seriesId={series.id}
        teams={teams.filter(team => !team.waitlistedAt).map((team) => ({
          id: team.id,
          number: team.number,
          name: team.name,
          category: team.category,
          division: team.division,
          wave: team.wave,
          waveId: team.waveId,
          station: team.station,
          slotManual: Boolean(team.slotManualAt),
          scored: scored.has(team.id),
          competitors: team.competitors.map((person) => ({
            id: person.id,
            fullName: person.fullName,
            studioId: person.studioId,
          })),
        }))}
        waves={waves}
        studios={studios.map((studio) => ({ id: studio.id, name: studio.name }))}
        waveCapacity={series.waveCapacity}
        canRebuild={series.status === "scheduled" && waves.every(wave => wave.status === "pending")}
        detailId={detailId}
        editMode={editMode}
        canBuild={canBuildSchedule(user) && !user.viewAs}
        canPlace={canPlaceTeams(user) && !user.viewAs}
        canEditTeams={can(user, "registrations.edit") && !user.viewAs}
        scheduled={schedule.governs}
        autoAssign={schedule.autoAssign}
        plan={schedule.plan}
        awards={schedule.awards}
        settingsHref={`${seriesHref(series.slug, "settings")}#category-schedule`}
      />
    </div>
  );
}
