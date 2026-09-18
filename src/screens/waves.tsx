import { notFound } from "next/navigation";
import type { SeriesScreenProps } from "@/screens/types";
import { WaveBoard } from "@/components/setup/wave-board";
import { getTranslator } from "@/lib/i18n/server";
import { getScopedRoster, getSeriesStudios } from "@/lib/queries";
import { requireSeries } from "@/lib/require-series";
import { requireRole, requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * THE RUNNING ORDER.
 *
 * Which teams run together, and when. A wave carries its own estimated start;
 * its length and capacity come from the competition settings. STARTING one is
 * the operator's job and lives next to the scores, where they will be standing.
 */
export default async function WavesPage(props: SeriesScreenProps, detailId?: string, editMode = false) {
  const user = await requirePermission(editMode ? "waves.manage" : "waves.view");
  if(editMode) await requireRole("admin");
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
              "The floor only holds so many teams at once, so the field is dealt into waves. Length and capacity come from the competition settings; each wave carries its own estimated start."
            )}
          </p>
        </div>
      </div>

      <WaveBoard
        seriesId={series.id}
        teams={teams.map((team) => ({
          id: team.id,
          number: team.number,
          name: team.name,
          category: team.category,
          division: team.division,
          wave: team.wave,
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
        detailId={detailId}
        editMode={editMode}
        isAdmin={user.role === "admin" && !user.viewAs}
        ownStudioId={user.studioId}
      />
    </div>
  );
}
