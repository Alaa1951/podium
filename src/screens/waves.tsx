import { notFound } from "next/navigation";
import type { SeriesScreenProps } from "@/screens/types";
import { WaveBoard } from "@/components/setup/wave-board";
import { getTranslator } from "@/lib/i18n/server";
import { getScopedRoster, getSeriesStudios } from "@/lib/queries";
import { requireSeries } from "@/lib/require-series";
import { can, requireConsoleAccess } from "@/lib/session";

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
  const [teams, studios] = await Promise.all([
    getScopedRoster(series.id, user),
    getSeriesStudios(series.id),
  ]);

  if (detailId && !waves.some(wave => wave.id === detailId)) notFound();
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Waves")}</h1>
          <p>
            {t(
              "The floor holds nine teams at once, one per station, so the field is dealt into waves. Each team keeps its station in every zone. Timing comes from the competition settings; each wave carries its own estimated start."
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
          competitors: team.competitors.map((person) => ({
            id: person.id,
            fullName: person.fullName,
            studioId: person.studioId,
          })),
        }))}
        waves={waves}
        studios={studios.map((studio) => ({ id: studio.id, name: studio.name }))}
        waveMinutes={series.waveMinutes}
        waveCapacity={series.waveCapacity}
        canRebuild={series.status === "scheduled" && waves.every(wave => wave.status === "pending")}
        detailId={detailId}
        editMode={editMode}
        isAdmin={can(user, "waves.edit") && !user.viewAs}
        canPlace={can(user, "waves.placeTeams") && !user.viewAs}
        canEditTeams={can(user, "registrations.edit") && !user.viewAs}
      />
    </div>
  );
}
