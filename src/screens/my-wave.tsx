import { notFound } from "next/navigation";
import Link from "next/link";
import { resolveMySeries, meHref } from "@/lib/participation";

import { PlainHeader } from "@/components/app/plain-header";
import { SheetRefresher } from "@/components/floor/sheet-refresher";
import { ZoneEntryCard, type ZoneEntryTeam } from "@/components/floor/zone-entry-card";
import { ZoneStaffPanel } from "@/components/floor/zone-staff-panel";
import { WaveFloor, type FloorTeam } from "@/components/floor/wave-floor";
import { WaveChangePanel } from "@/components/me/wave-change-panel";
import { can } from "@/lib/access";
import { zoneArrival, zoneDuty, type FloorTiming } from "@/lib/floor";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { getSeriesWaves, getSeriesZones } from "@/lib/queries";
import { homeFor, requireUser } from "@/lib/session";
import { judgePostsFor, listZoneStaff } from "@/lib/zone-staff";

export const dynamic = "force-dynamic";

function clock(ms: number | null) {
  if (ms === null) return "--:--";
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * THE JUDGE SHEET.
 *
 * A judge works one ZONE for the whole competition, standing at one STATION.
 * This sheet shows them ONE team: the one on their station, in the wave their
 * zone is on — that zone's movements only. Nothing appears before a wave has
 * started and reached the zone, and nothing from a wave the zone has moved
 * on from; when there is no team, the sheet says so, and which wave comes
 * next and when. It re-reads itself every few seconds and at the moment the
 * clock changes something, so a started wave appears on its own. The server
 * writes by the same rules (saveZoneScore).
 *
 * A zone LEADER sees every station of their zone, finishes any sheet a judge
 * left open, places the judges and reserves on stations, and starts the next
 * wave. An athlete with no post sees their own wave.
 */
export default async function MyWavePage(detailId?: string, requestedSeries?: string) {
  const user = await requireUser();
  const { t } = await getTranslator();
  // Posts are worked through the Judge sheet: without it (the Judge role
  // taken away) a leftover ZoneStaff row opens nothing.
  const posts = can(user, "judgeSheet.view") ? await judgePostsFor(user.id) : [];

  if (posts.length === 0 && user.role === "competitor" && !detailId) {
    const selected = await resolveMySeries(user.id, requestedSeries);
    const team = selected ? await prisma.team.findFirst({
      where: { seriesId: selected.id, archivedAt: null, competitors: { some: { userId: user.id } } },
      include: { series: true, waveRef: true },
    }) : null;
    return (
      <div className="screen">
        <PlainHeader roleLabel={user.name ?? t("Athlete")} />
        <div className="screen-head">
          <h1>{t("My wave")}</h1>
        </div>
        {team ? (
          <article className="mobile-detail">
            <h2>{team.series.name}</h2>
            <dl>
              <dt>{t("Team")}</dt>
              <dd>{team.name}</dd>
              <dt>{t("Wave")}</dt>
              <dd>{!team.waitlistedAt ? team.waveRef?.number ?? "—" : "—"}</dd>
              <dt>{t("Station")}</dt>
              <dd>{team.station ?? "—"}</dd>
              <dt>{t("Expected start time")}</dt>
              <dd>{!team.waitlistedAt ? team.waveRef?.startTime ?? "—" : "—"}</dd>
              <dt>{t("Status")}</dt>
              <dd>{t(team.waveRef?.status ?? "pending")}</dd>
              <dt>{t("Venue")}</dt>
              <dd>{team.series.venue}</dd>
            </dl>
            <Link className="btn btn-primary" href={meHref(team.seriesId)}>
              {t("My team")}
            </Link>
            <WaveChangePanel teamId={team.id} userId={user.id} readOnly={!!user.viewAs || !can(user, "athleteHome.view")}
              eligible={!team.waitlistedAt && team.waveRef?.status === "pending" && team.series.status !== "final" && !team.series.archivedAt} />
          </article>
        ) : (
          <p className="notice">{t("No entry found for you yet.")}</p>
        )}
      </div>
    );
  }

  if (posts.length === 0) {
    if (detailId) notFound();
    return (
      <div className="screen">
        <PlainHeader roleLabel={user.name ?? t("Judge")} homeHref="/home" />
        <div className="screen-head">
          <div>
            <h1>{t("Your score sheet")}</h1>
          </div>
        </div>
        <div className="notice">
          <strong>{t("You are not on a zone yet.")}</strong>{" "}
          {t("The supervisor puts judges on zones from Wave control, and your zone leader places you on a station.")}
        </div>
      </div>
    );
  }

  // Where this person works when they are not on the floor, and each
  // competition's board — the links at the top of the sheet.
  const otherHome = user.role === "staff" && can(user, "dashboard.view") ? "/" : homeFor(user.role);
  const boards = [...new Map(posts.map((post) => [post.series.slug, { slug: post.series.slug, name: post.series.name }])).values()];

  const now = new Date();
  const panels = await Promise.all(
    posts.map(async (post) => {
      const [zones, series, waves] = await Promise.all([
        getSeriesZones(post.seriesId),
        prisma.series.findUnique({
          where: { id: post.seriesId },
          select: { zoneWorkMinutes: true, zoneBreakMinutes: true },
        }),
        prisma.wave.findMany({
          where: { seriesId: post.seriesId, NOT: { startedAt: null } },
          orderBy: { startedAt: "desc" },
          select: { id: true, number: true, status: true, startedAt: true, endsAt: true },
        }),
      ]);
      const ordered = [...zones].sort((a, b) => a.number - b.number);
      const zoneIndex = ordered.findIndex((zone) => zone.id === post.zone.id);
      const zone = ordered[zoneIndex];
      const timing: FloorTiming = {
        workMinutes: series?.zoneWorkMinutes ?? 15,
        breakMinutes: series?.zoneBreakMinutes ?? 5,
        zoneCount: ordered.length,
      };

      // WHAT THIS POST SEES — the same rules the server writes by
      // (floor.ts › zoneDuty; zone-score-rules.ts):
      //   • a judge or reserve: the team on their station, in the wave their
      //     zone is ON — nothing that has not reached the zone, nothing the
      //     zone has moved on from, no other station;
      //   • the zone leader: every station of that wave, and any earlier
      //     wave's sheet still not submitted (the zone's safety valve).
      const duty = zoneDuty(waves, zoneIndex, timing, now);
      const leader = post.position === "leader";
      const reachedWaves = waves.filter((wave) => zoneArrival(wave, zoneIndex, timing, now) !== null);
      const shownWaves = leader ? reachedWaves : duty.wave ? [duty.wave] : [];

      const teams = shownWaves.length
        ? await prisma.team.findMany({
            where: {
              waveId: { in: shownWaves.map((wave) => wave.id) },
              archivedAt: null,
              ...(leader ? {} : { station: post.station ?? -1 }),
              ...(detailId ? { id: detailId } : {}),
            },
            orderBy: [{ station: "asc" }, { number: "asc" }],
            select: {
              id: true,
              number: true,
              name: true,
              station: true,
              waveId: true,
              competitors: { select: { fullName: true }, orderBy: { position: "asc" } },
              score: {
                select: {
                  entries: { select: { inputId: true, value: true } },
                  zones: { where: { zoneId: post.zone.id, status: "submitted" }, select: { zoneId: true } },
                },
              },
            },
          })
        : [];

      const toEntry = (team: (typeof teams)[number]): ZoneEntryTeam => {
        const wave = shownWaves.find((row) => row.id === team.waveId)!;
        return {
          id: team.id,
          number: team.number,
          name: team.name,
          station: team.station,
          competitors: team.competitors.map((person) => person.fullName),
          waveNumber: wave.number,
          values: Object.fromEntries((team.score?.entries ?? []).map((entry) => [entry.inputId, entry.value])),
          locked: (team.score?.zones.length ?? 0) > 0,
          waveEndsAt: wave.endsAt?.toISOString() ?? null,
          finisherWorkMinutes: timing.workMinutes,
        };
      };

      const staff = leader ? (await listZoneStaff(post.seriesId)).filter((row) => row.id === post.zone.id) : [];

      // A zone leader sends the next wave onto the floor from here (Start
      // only — canControlWave). Shown: the waves on the floor and the next
      // one to go, which is all a leader decides about.
      const leaderFloor =
        leader && post.series.status === "live"
          ? await (async () => {
              const all = await getSeriesWaves(post.seriesId);
              const next = all
                .filter((wave) => wave.status === "pending")
                .sort((a, b) => a.number - b.number)[0];
              const floorWaves = all.filter((wave) => wave.status === "running" || wave.id === next?.id);
              const floorTeams = floorWaves.length
                ? await prisma.team.findMany({
                    where: { seriesId: post.seriesId, archivedAt: null, waveId: { in: floorWaves.map((wave) => wave.id) } },
                    orderBy: [{ station: "asc" }, { number: "asc" }],
                    select: { id: true, number: true, name: true, station: true, waveId: true },
                  })
                : [];
              const teamsByWave: Record<string, FloorTeam[]> = {};
              for (const team of floorTeams) {
                if (!team.waveId) continue;
                (teamsByWave[team.waveId] ??= []).push({ id: team.id, number: team.number, name: team.name, station: team.station });
              }
              return {
                waves: floorWaves,
                teamsByWave,
                zones: ordered.map((row) => ({ id: row.id, number: row.number, name: row.name })),
              };
            })()
          : null;

      return {
        post,
        zone,
        // The wave this zone is on. Once it has left the zone, only a sheet
        // still open stays — to be submitted before the next wave arrives.
        current: duty.wave
          ? {
              waveNumber: duty.wave.number,
              phase: duty.phase,
              remaining: clock(duty.phaseRemainingMs),
              teams: teams
                .filter((team) => team.waveId === duty.wave!.id)
                .map(toEntry)
                .filter((team) => duty.phase !== "left" || !team.locked || !!detailId),
            }
          : null,
        next: duty.next ? { waveNumber: duty.next.wave.number, inTime: clock(duty.next.inMs) } : null,
        // The leader's safety valve: earlier waves' sheets nobody submitted.
        earlier: leader
          ? teams
              .filter((team) => team.waveId !== duty.wave?.id)
              .map(toEntry)
              .filter((team) => !team.locked || !!detailId)
          : [],
        // When this panel next changes by the clock alone — the sheet
        // re-reads itself right then, not up to a poll later.
        changeInMs: Math.min(duty.phaseRemainingMs ?? Infinity, duty.next?.inMs ?? Infinity),
        staff,
        leaderFloor,
        timing,
      };
    })
  );

  if (detailId && !panels.some((panel) => panel.current?.teams.length || panel.earlier.length)) notFound();

  return (
    <div className="screen">
      <SheetRefresher seconds={5} changeInMs={Math.min(...panels.map((panel) => panel.changeInMs))} />
      <PlainHeader roleLabel={user.name ?? t("Judge")} homeHref="/my-wave" />
      <div className="screen-head">
        <div>
          <h1>{t("Your score sheet")}</h1>
          <p>{t("The team on your station, in whichever wave is in your zone. It changes by itself when the next wave arrives.")}</p>
        </div>
      </div>

      {/* A live post makes this sheet the person's home (homeForUser), so it
          must lead back to the rest of their work — an organiser's console, a
          gym's area — and to the live board of each competition they work. */}
      <div className="me-links" style={{ marginBottom: 18 }}>
        {user.role !== "competitor" ? (
          <Link href={otherHome} className="btn btn-secondary">
            {t("Home")}
          </Link>
        ) : null}
        {boards.map((board) => (
          <Link key={board.slug} href={`/series/${board.slug}/board`} className="btn btn-secondary">
            {t("Live board")}
            {boards.length > 1 ? ` · ${board.name}` : ""}
          </Link>
        ))}
      </div>

      {panels.map(({ post, zone, current, next, earlier, staff, leaderFloor, timing }) => (
        <section key={post.id} style={{ marginBottom: 34 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>
            {post.series.name} · {t("Zone")} {post.zone.number} {"///"} {t(post.zone.name)} ·{" "}
            {post.position === "leader"
              ? t("Zone leader")
              : post.station
                ? t("Station {station}", { station: post.station })
                : t("No station yet")}
          </h2>

          {post.series.status !== "live" ? (
            <div className="notice">{t("The competition has not started yet. Your sheet opens when it does.")}</div>
          ) : post.position !== "leader" && !post.station ? (
            <div className="notice">{t("Waiting for your zone leader to place you on a station.")}</div>
          ) : current && (current.phase !== "left" || current.teams.length > 0) ? (
            <>
              <p className="reg-sub pd-num">
                {t("Wave")} {current.waveNumber} ·{" "}
                {current.phase === "work"
                  ? t("working · {time} left", { time: current.remaining })
                  : current.phase === "break"
                    ? t("changing zones · {time}", { time: current.remaining })
                    : t("has left your zone — submit before the next wave arrives.")}
              </p>
              <div className="zone-entries">
                {current.teams.map((team) => (
                  <ZoneEntryCard key={team.id} team={team} zone={zone} />
                ))}
                {current.teams.length === 0 ? (
                  <p className="reg-sub">
                    {post.position === "leader" ? t("No team in your zone in this wave.") : t("No team on your station in this wave.")}
                  </p>
                ) : null}
              </div>
              {current.phase === "left" && next ? (
                <p className="reg-sub pd-num">
                  {t("Wave {wave} reaches Zone {zone} in {time}.", { wave: next.waveNumber, zone: post.zone.number, time: next.inTime })}
                </p>
              ) : null}
            </>
          ) : (
            // Nothing to score: no wave has reached this zone yet, or the zone
            // has moved on and every sheet is in. Say so — and what is coming.
            <div className="notice pd-num">
              <strong>
                {post.position === "leader" ? t("No team in your zone right now.") : t("No team on your zone or station right now.")}
              </strong>{" "}
              {next
                ? t("Wave {wave} is on the floor and reaches Zone {zone} in {time}. Your team appears here by itself.", {
                    wave: next.waveNumber,
                    zone: post.zone.number,
                    time: next.inTime,
                  })
                : t("A team appears here by itself when a wave that has started reaches Zone {zone}.", { zone: post.zone.number })}
            </div>
          )}

          {earlier.length ? (
            <>
              <h3 style={{ marginTop: 18 }}>{t("Still to submit from earlier waves")}</h3>
              <div className="zone-entries">
                {earlier.map((team) => (
                  <ZoneEntryCard key={team.id} team={team} zone={zone} />
                ))}
              </div>
            </>
          ) : null}

          {leaderFloor ? (
            <div style={{ marginTop: 18 }}>
              <h3 style={{ marginTop: 0 }}>{t("Waves")}</h3>
              <p className="reg-sub">
                {t("As zone leader you can start the next wave once Zone 1 is free. Ending or resetting a wave is the supervisor's, on Wave control.")}
              </p>
              <WaveFloor
                waves={leaderFloor.waves}
                teamsByWave={leaderFloor.teamsByWave}
                zones={leaderFloor.zones}
                timing={timing}
                canControl={!user.viewAs}
                startOnly
                poll={false}
              />
            </div>
          ) : null}

          {post.position === "leader" && staff.length ? (
            <ZoneStaffPanel
              title={t("Your zone team")}
              zones={staff.map((row) => ({
                id: row.id,
                number: row.number,
                name: row.name,
                staff: row.staff.map((member) => ({
                  id: member.id,
                  userId: member.user.id,
                  position: member.position,
                  station: member.station,
                  name: member.user.name ?? member.user.email,
                  email: member.user.email,
                })),
              }))}
              candidates={[]}
              canAssign={false}
              canPlace={!user.viewAs}
              stations={post.series.waveCapacity}
            />
          ) : null}
        </section>
      ))}
    </div>
  );
}
