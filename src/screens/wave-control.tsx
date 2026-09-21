import Link from "next/link";

import type { SeriesScreenProps } from "@/screens/types";

import { WaveFloor, type FloorTeam } from "@/components/floor/wave-floor";
import { ZoneStaffPanel } from "@/components/floor/zone-staff-panel";
import { can } from "@/lib/access";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { requireAccess } from "@/lib/session";
import { judgeCandidates, listZoneStaff } from "@/lib/zone-staff";

export const dynamic = "force-dynamic";

/**
 * WAVE CONTROL — the supervisor's page.
 *
 * One START per wave; the wave then moves through every zone by itself (the
 * work time, then the changeover, no changeover after the last zone), and a
 * new wave may start once Zone 1 is free. Below the waves, the floor map shows
 * which wave is in which zone right now, and the zone teams — leader, judges
 * and reserves per zone — are assigned here for the whole competition.
 *
 * Gated by waveControl.view; the buttons need waveControl.control (the
 * supervisor permission) and the zone teams zoneStaff.assign. Score entry is
 * elsewhere: the judges have their own sheet.
 */
export default async function WaveControlPage(props: SeriesScreenProps) {
  const user = await requireAccess("waveControl.view");
  const { t } = await getTranslator();
  const { series, waves } = await requireSeries(props.params);
  const live = !user.viewAs;
  const canControl = live && can(user, "waveControl.control");
  const canAssign = live && can(user, "zoneStaff.assign");

  const [teams, zones, staff, candidates] = await Promise.all([
    prisma.team.findMany({
      where: { seriesId: series.id, archivedAt: null, NOT: { waveId: null } },
      orderBy: [{ station: "asc" }, { number: "asc" }],
      select: { id: true, number: true, name: true, station: true, waveId: true },
    }),
    prisma.zone.findMany({
      where: { seriesId: series.id },
      orderBy: { number: "asc" },
      select: { id: true, number: true, name: true },
    }),
    can(user, "zoneStaff.view") ? listZoneStaff(series.id) : Promise.resolve([]),
    canAssign ? judgeCandidates() : Promise.resolve([]),
  ]);

  const byWave: Record<string, FloorTeam[]> = {};
  for (const team of teams) {
    if (!team.waveId) continue;
    (byWave[team.waveId] ??= []).push({ id: team.id, number: team.number, name: team.name, station: team.station });
  }

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Wave control")}</h1>
          <p>
            {t(
              "Press Start once per wave. It then moves through every zone by itself: {work} minutes of work, {break} minutes to change zones, no changeover after the last zone. A new wave can start as soon as Zone 1 is free.",
              { work: series.zoneWorkMinutes, break: series.zoneBreakMinutes }
            )}
          </p>
        </div>
      </div>

      {series.status !== "live" ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          {t("Waves can only be started while the competition is running. Set it to Running in Settings first.")}
        </div>
      ) : null}

      {/* The screens that hang over the floor. Addressed by zone, because a
          team keeps its station number through every zone of its wave — so a
          link per zone is the thing somebody actually opens on a wall screen.
          Without these the routes exist and nobody can find them. */}
      {zones.length ? (
        <>
          <div className="console-group-title" style={{ marginTop: 22 }}>
            {t("Screens for the floor")}
          </div>
          <p className="reg-sub" style={{ marginTop: 4 }}>
            {t("Open one on the screen above each rig. It follows the wave in that zone by itself.")}
          </p>
          <div className="me-links" style={{ marginTop: 8 }}>
            {zones.map((zone) => (
              <Link
                key={zone.id}
                href={`${seriesHref(series.slug)}/zone/${zone.number}/stations`}
                className="btn btn-secondary"
              >
                {t("Zone")} {zone.number}
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <WaveFloor
        waves={waves}
        teamsByWave={byWave}
        zones={zones}
        timing={{ workMinutes: series.zoneWorkMinutes, breakMinutes: series.zoneBreakMinutes, zoneCount: zones.length }}
        canControl={canControl && series.status === "live"}
      />

      {can(user, "zoneStaff.view") ? (
        <ZoneStaffPanel
          zones={staff.map((zone) => ({
            id: zone.id,
            number: zone.number,
            name: zone.name,
            staff: zone.staff.map((row) => ({
              id: row.id,
              userId: row.user.id,
              position: row.position,
              station: row.station,
              name: row.user.name ?? row.user.email,
              email: row.user.email,
            })),
          }))}
          candidates={candidates.map((person) => ({ id: person.id, label: person.name ? `${person.name} · ${person.email}` : person.email }))}
          canAssign={canAssign}
        />
      ) : null}
    </div>
  );
}
