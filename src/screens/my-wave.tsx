import { notFound } from "next/navigation";
import Link from "next/link";
import { resolveMySeries, meHref } from "@/lib/participation";

import { PlainHeader } from "@/components/app/plain-header";
import { SheetRefresher } from "@/components/floor/sheet-refresher";
import { ZoneEntryCard, type ZoneEntryTeam } from "@/components/floor/zone-entry-card";
import { ZoneStaffPanel } from "@/components/floor/zone-staff-panel";
import { hasReachedZone, waveInZone, wavePosition, type FloorTiming } from "@/lib/floor";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { getSeriesZones } from "@/lib/queries";
import { requireUser } from "@/lib/session";
import { judgePostsFor, listZoneStaff } from "@/lib/zone-staff";

export const dynamic = "force-dynamic";

/** How many waves back a post still shows, so a late submit can be finished. */
const RECENT_WAVES = 3;

function clock(ms: number | null) {
  if (ms === null) return "--:--";
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * THE JUDGE SHEET.
 *
 * A judge works one ZONE for the whole competition, standing at one STATION.
 * This sheet shows them the team on their station in whichever wave is in
 * their zone right now — that zone's movements only — and the teams of the
 * last few waves at their station, so a zone left unsubmitted can still be
 * finished. It re-reads itself every few seconds, so the next wave appears on
 * its own.
 *
 * A zone LEADER sees every station of their zone, and places the judges
 * and reserves on stations. An athlete with no post sees their own wave.
 */
export default async function MyWavePage(detailId?: string, requestedSeries?: string) {
  const user = await requireUser();
  const { t } = await getTranslator();
  const posts = await judgePostsFor(user.id);

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
              <dd>{team.wave}</dd>
              <dt>{t("Station")}</dt>
              <dd>{team.station ?? "—"}</dd>
              <dt>{t("Start time")}</dt>
              <dd>{team.waveRef?.startTime ?? "—"}</dd>
              <dt>{t("Status")}</dt>
              <dd>{t(team.waveRef?.status ?? "pending")}</dd>
              <dt>{t("Venue")}</dt>
              <dd>{team.series.venue}</dd>
            </dl>
            <Link className="btn btn-primary" href={meHref(team.seriesId)}>
              {t("My team")}
            </Link>
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

      const withState = waves.map((wave) => ({ ...wave, completed: wave.status === "complete" }));
      const current = waveInZone(
        withState.filter((wave) => wave.status === "running"),
        zoneIndex,
        timing,
        now
      );
      // Waves that have already passed this zone, newest first.
      const passed = withState
        .filter((wave) => wave.id !== current?.wave.id)
        .filter((wave) => wave.completed || hasReachedZone(wave, zoneIndex, timing, now))
        .filter((wave) => {
          const position = wavePosition(wave, timing, now);
          return position.phase === "done" || (position.zoneIndex ?? 0) > zoneIndex;
        })
        .slice(0, RECENT_WAVES);
      const shownWaves = [...(current ? [current.wave] : []), ...passed];

      const leader = post.position === "leader";
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
        };
      };

      const staff = leader ? (await listZoneStaff(post.seriesId)).filter((row) => row.id === post.zone.id) : [];

      return {
        post,
        zone,
        current: current
          ? {
              waveNumber: current.wave.number,
              phase: current.phase,
              remaining: clock(current.phaseRemainingMs),
              teams: teams.filter((team) => team.waveId === current.wave.id).map(toEntry),
            }
          : null,
        earlier: teams
          .filter((team) => team.waveId !== current?.wave.id)
          .map(toEntry)
          .filter((team) => !team.locked || !!detailId),
        staff,
      };
    })
  );

  if (detailId && !panels.some((panel) => panel.current?.teams.length || panel.earlier.length)) notFound();

  return (
    <div className="screen">
      <SheetRefresher />
      <PlainHeader roleLabel={user.name ?? t("Judge")} homeHref="/my-wave" />
      <div className="screen-head">
        <div>
          <h1>{t("Your score sheet")}</h1>
          <p>{t("The team on your station, in whichever wave is in your zone. It changes by itself when the next wave arrives.")}</p>
        </div>
      </div>

      {panels.map(({ post, zone, current, earlier, staff }) => (
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
          ) : current ? (
            <>
              <p className="reg-sub pd-num">
                {t("Wave")} {current.waveNumber} ·{" "}
                {current.phase === "work" ? t("working · {time} left", { time: current.remaining }) : t("changing zones · {time}", { time: current.remaining })}
              </p>
              <div className="zone-entries">
                {current.teams.map((team) => (
                  <ZoneEntryCard key={team.id} team={team} zone={zone} />
                ))}
                {current.teams.length === 0 ? <p className="reg-sub">{t("No team on your station in this wave.")}</p> : null}
              </div>
            </>
          ) : (
            <div className="notice">{t("Waiting for the next wave to reach your zone.")}</div>
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
