import type { SeriesScreenProps } from "@/screens/types";

import { MarshallingBoard, type MarshallingTeam } from "@/components/floor/marshalling-board";
import { canAny } from "@/lib/access";
import type { PlannedWave } from "@/lib/floor";
import { getTranslator } from "@/lib/i18n/server";
import { marshallingPlan } from "@/lib/marshalling";
import { prisma } from "@/lib/prisma";
import { formatQatarDayKey, parseQatarWallTime } from "@/lib/qatar-time";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { requireConsoleAnyAccess } from "@/lib/session";
import { isCompeting } from "@/lib/team-status";

export const dynamic = "force-dynamic";

/**
 * MARSHALLING — the floor for the people who move athletes.
 *
 * What is in each zone and what comes next, where every wave on the floor
 * goes next and when, and the next waves to call up: station by station,
 * with names and whether each pair has checked in. Nothing here starts,
 * ends or moves a wave — that is Wave control. The one thing that can be
 * done here is check a pair in, for whoever holds that.
 *
 * Open to `marshalling.view` (volunteers) and to anyone who sees Wave
 * control. The whole field is shown, paid or not: a pair paying at the door
 * still has to be sent to its station.
 */
export default async function MarshallingPage(props: SeriesScreenProps) {
  const user = await requireConsoleAnyAccess(["marshalling.view", "waveControl.view"]);
  const { t } = await getTranslator();
  const { series } = await requireSeries(props.params);
  const now = new Date();

  const [zones, waves, teams] = await Promise.all([
    prisma.zone.findMany({ where: { seriesId: series.id }, orderBy: { number: "asc" }, select: { id: true, number: true, name: true } }),
    prisma.wave.findMany({
      where: { seriesId: series.id },
      orderBy: { number: "asc" },
      select: { id: true, number: true, status: true, startedAt: true, endsAt: true, startTime: true, capacity: true },
    }),
    prisma.team.findMany({
      where: { seriesId: series.id, archivedAt: null, waitlistedAt: null, waveId: { not: null } },
      orderBy: [{ station: "asc" }, { number: "asc" }],
      select: {
        id: true,
        number: true,
        name: true,
        station: true,
        waveId: true,
        attendedAt: true,
        paymentStatus: true,
        waitlistedAt: true,
        studio: { select: { name: true } },
        competitors: { select: { fullName: true }, orderBy: { position: "asc" } },
      },
    }),
  ]);

  const teamsByWave: Record<string, MarshallingTeam[]> = {};
  for (const team of teams) {
    if (!team.waveId) continue;
    (teamsByWave[team.waveId] ??= []).push({
      id: team.id,
      number: team.number,
      name: team.name,
      station: team.station,
      athletes: team.competitors.map((person) => person.fullName),
      studio: team.studio?.name ?? null,
      checkedIn: !!team.attendedAt,
      competing: isCompeting(team),
    });
  }

  const day = formatQatarDayKey(series.competitionDate);
  const planned: PlannedWave[] = waves.map((wave) => ({
    id: wave.id,
    number: wave.number,
    status: wave.status,
    startedAt: wave.startedAt,
    endsAt: wave.endsAt,
    plannedStart: parseQatarWallTime(`${day}T${wave.startTime}`),
    hasTeams: (teamsByWave[wave.id]?.length ?? 0) > 0,
  }));
  const timing = { workMinutes: series.zoneWorkMinutes, breakMinutes: series.zoneBreakMinutes, zoneCount: zones.length };
  const plan = marshallingPlan(planned, timing, now);

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Marshalling")}</h1>
          <p>
            {t(
              "Where every wave is, where it goes next, and who to call up for the next start. Times for a wave that has not started are estimates."
            )}
          </p>
        </div>
      </div>

      {series.status === "scheduled" ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          {t("The competition has not started yet. The call-up below follows the planned start times.")}
        </div>
      ) : null}

      <MarshallingBoard
        zones={zones.map((zone) => ({ number: zone.number, name: zone.name }))}
        waves={Object.fromEntries(waves.map((wave) => [wave.id, { number: wave.number, capacity: wave.capacity }]))}
        teamsByWave={teamsByWave}
        plan={{
          zones: plan.zones.map((zone) => ({
            zoneIndex: zone.zoneIndex,
            current: zone.current ? { ...zone.current, endsAt: zone.current.endsAt.toISOString() } : null,
            next: zone.next ? { ...zone.next, arrivesAt: zone.next.arrivesAt.toISOString() } : null,
          })),
          moves: plan.moves.map((move) => ({ ...move, at: move.at.toISOString() })),
          callUp: plan.callUp.map((row) => ({ ...row, startsAt: row.startsAt.toISOString() })),
        }}
        canCheckIn={!user.viewAs && canAny(user, ["registrations.attendance", "registrations.payment"])}
        rigBase={seriesHref(series.slug)}
      />
    </div>
  );
}
