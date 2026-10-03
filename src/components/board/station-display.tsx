"use client";

import { useEffect, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { useBoardClock } from "@/components/board/use-board-clock";
import type { BoardPayload } from "@/lib/board";
import { DEFAULT_ATHLETE_PHOTO } from "@/lib/athlete-photo";
import { remainingClock } from "@/lib/floor";
import { nextOnStation, stationView, zoneStations, type StationView } from "@/lib/stations";

type UpNext = ReturnType<typeof nextOnStation>;

const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Qatar", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "12:05" for a countdown on a wall screen. */
function countdown(ms: number) {
  const { minutes, seconds } = remainingClock(ms);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * When the payload's countdown points at, as the venue's wall clock. `inMs`
 * already has the payload's age subtracted (nextOnStation), so now + inMs is
 * the arrival — steady as the clock ticks, because both sides move together.
 * Rendered only once mounted: the server's clock is not this device's, and a
 * wall time baked into the first HTML would fight the hydration.
 */
const arrivalWallTime = (inMs: number, nowMs: number) => timeFormat.format(new Date(nowMs + inMs));

/**
 * The device clock, once the browser has taken over — null on the server and
 * the first paint, so no wall time is baked into HTML that hydration must then
 * fight. Ticks every second, like the countdowns it labels (judge-day.tsx
 * keeps its wall clock the same way).
 */
function useWallClock() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setNow(Date.now());
    });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(tick);
    };
  }, []);
  return now;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SCREEN OVER A RIG.
//
// Bolted above one station, read from ten metres away by people who are out of
// breath. So: the team name as large as it will go, and almost nothing else.
//
// It refreshes itself through the SAME payload and the same ten-second poll as
// the wall board (`use-board-clock.ts`), rather than a second endpoint of its
// own. One source means the rig and the board cannot disagree about who is on
// the floor — and disagreeing in front of the room is the failure that matters.
// ─────────────────────────────────────────────────────────────────────────────

export function StationDisplay({
  initial,
  zoneNumber,
  station,
  zoneName,
}: {
  initial: BoardPayload;
  zoneNumber: number;
  station: number;
  zoneName: string | null;
}) {
  const t = useT();
  const [data, setData] = useState(initial);

  // A fresh server render must win over the polled copy.
  const [lastProp, setLastProp] = useState(initial);
  if (lastProp !== initial) {
    setLastProp(initial);
    setData(initial);
  }

  const { elapsedMs } = useBoardClock(data, initial.seriesId, setData);
  const view = stationView({ waves: data.waves, teams: data.teams, zoneNumber, station });
  // WHO RIDES IN NEXT — on this rig, in the next wave to reach this zone, with
  // the athletes' names and the time it starts. Shown whatever the screen is
  // doing (a pair working, a rig unused, an idle floor): the judge calls the
  // next pair over during the changeover and checks them against THIS, before
  // their clock ever starts. Older payloads (a cached page) have no list.
  const next = nextOnStation({ upNext: data.upNext ?? [], teams: data.teams, zoneNumber, station, elapsedMs });

  return (
    <div className="station-screen">
      <div className="station-screen-head">
        <span className="station-screen-kicker">
          {t("Zone")} {zoneNumber}
          {zoneName ? ` · ${t(zoneName)}` : ""}
        </span>
        <span className="station-screen-rig display">{station}</span>
      </div>
      <StationBody view={view} next={next} />
      {view.state !== "idle" && next ? <StationNextStrip next={next} /> : null}
    </div>
  );
}

/** Every rig in one zone, for a venue with one screen per zone. */
export function ZoneStationsDisplay({
  initial,
  zoneNumber,
  zoneName,
}: {
  initial: BoardPayload;
  zoneNumber: number;
  zoneName: string | null;
}) {
  const t = useT();
  const now = useWallClock();
  const [data, setData] = useState(initial);
  const [lastProp, setLastProp] = useState(initial);
  if (lastProp !== initial) {
    setLastProp(initial);
    setData(initial);
  }
  const { elapsedMs } = useBoardClock(data, initial.seriesId, setData);

  const rigs = zoneStations({ waves: data.waves, teams: data.teams, zoneNumber });
  const coming = (data.upNext ?? []).find((row) => row.zoneNumber === zoneNumber) ?? null;
  const comingTeams = coming
    ? data.teams.filter((team) => team.wave === coming.wave && team.station !== null).sort((a, b) => a.station! - b.station!)
    : [];

  return (
    <div className="station-screen">
      <div className="station-screen-head">
        <span className="station-screen-kicker">
          {t("Zone")} {zoneNumber}
          {zoneName ? ` · ${t(zoneName)}` : ""}
        </span>
      </div>
      {rigs.length === 0 ? (
        <>
          <p className="station-screen-idle">{t("No wave in this zone right now.")}</p>
          {coming ? (
            <>
              <p className="station-screen-wave">
                {t("Up next")} · {t("Wave")} {coming.wave} · {countdown(coming.inMs - elapsedMs)}
                {coming.estimated ? ` (${t("estimated")})` : ""}
              </p>
              <div className="station-grid">
                {comingTeams.map((team) => (
                  <div className="station-card" key={team.id}>
                    <span className="station-card-rig display">{team.station}</span>
                    <span className="station-card-team">{team.name}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <div className="station-grid">
          {rigs.map((rig) => (
            <div className="station-card" key={rig.station} data-empty={rig.view.state !== "team" || undefined}>
              <span className="station-card-rig display">{rig.station}</span>
              <span className="station-card-team">
                {rig.view.state === "team" ? rig.view.team.name : t("—")}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* While the zone holds a wave, the one coming next still gets a line —
          the changeover is when its pairs are called over and briefed. */}
      {rigs.length > 0 && coming ? (
        <p className="station-screen-wave">
          {t("Up next")} · {t("Wave")} {coming.wave}
          {now !== null ? ` · ${arrivalWallTime(coming.inMs, now)}` : ""} · {countdown(coming.inMs - elapsedMs)}
          {coming.estimated ? ` (${t("estimated")})` : ""}
        </p>
      ) : null}
    </div>
  );
}

function StationBody({ view, next }: { view: StationView; next: UpNext }) {
  const t = useT();
  const now = useWallClock();

  if (view.state === "idle") {
    if (next?.team) {
      return (
        <div className="station-screen-body">
          <span className="station-screen-wave">
            {t("Up next")} · {t("Wave")} {next.wave}
          </span>
          <h1 className="station-screen-team display">{next.team.name}</h1>
          {next.team.competitors.filter(Boolean).length ? (
            <p className="station-screen-people">{next.team.competitors.filter(Boolean).join(" & ")}</p>
          ) : null}
          <p className="station-screen-idle">
            {now !== null ? `${arrivalWallTime(next.inMs, now)} · ` : ""}
            {t("in {time}", { time: countdown(next.inMs) })}
            {next.estimated ? ` (${t("estimated")})` : ""}
          </p>
        </div>
      );
    }
    return <p className="station-screen-idle">{t("No wave in this zone right now.")}</p>;
  }

  if (view.state === "empty") {
    return (
      <div className="station-screen-body">
        <p className="station-screen-idle">{t("This rig is not in use for this wave.")}</p>
        <span className="station-screen-wave">
          {t("Wave")} {view.wave}
        </span>
      </div>
    );
  }

  const clock = view.phaseRemainingMs === null ? null : remainingClock(view.phaseRemainingMs);

  return (
    <div className="station-screen-body">
{/* THE PAIR, IN ONE PICTURE, when they have one — the team photograph is
          made for exactly this screen, and two separate crops beside each other
          is what it replaced. Falls back to the individual portraits for a team
          whose composite has not been generated yet, so a rig is never blank. */}
      {view.team.groupPortrait ? (
        <figure className="station-group">
          {/* eslint-disable-next-line @next/next/no-img-element -- a wall screen
              loads this once and holds it for a whole wave; the optimiser buys
              nothing and adds a request path to go wrong. */}
          <img src={view.team.groupPortrait} alt="" className="station-group-img" />
          <figcaption className="station-portrait-name">
            {view.team.competitors.filter(Boolean).join(" & ")}
          </figcaption>
        </figure>
      ) : (
        <div className="station-portraits">
          {view.team.competitors.map((name, index) => (
            <figure className="station-portrait" key={`${name}-${index}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- as above. */}
              <img
                src={view.team.portraits[index] ?? DEFAULT_ATHLETE_PHOTO}
                alt=""
                className="station-portrait-img"
              />
              <figcaption className="station-portrait-name">{name}</figcaption>
            </figure>
          ))}
        </div>
      )}

      {/* The team name, as big as the box allows. Everything else is a caption. */}
      <h1 className="station-screen-team display">{view.team.name}</h1>
      <div className="station-screen-meta">
        <span>
          {t("Wave")} {view.wave}
        </span>
        <span>
          {t("Team")} {view.team.number}
        </span>
        {/* The changeover is called out, because during it the pair is still
            standing here and the judge is still writing. */}
        <span data-phase={view.phase}>
          {view.phase === "break" ? t("Changeover") : t("Working")}
          {clock ? ` · ${clock.minutes}:${String(clock.seconds).padStart(2, "0")}` : ""}
        </span>
      </div>
    </div>
  );
}

/**
 * THE STRIP UNDER THE PAIR ON THE RIG — who comes next, on this exact rig, and
 * when. It stays while somebody works and through the changeover, so the judge
 * and the incoming pair match each other to a name BEFORE the wave starts and
 * the score sheet opens.
 */
function StationNextStrip({ next }: { next: NonNullable<UpNext> }) {
  const t = useT();
  const now = useWallClock();
  const athletes = next.team ? next.team.competitors.filter(Boolean) : [];
  return (
    <footer className="station-screen-next">
      <span>{t("Up next on this rig")}</span>
      <span className="station-screen-next-team">
        {t("Wave")} {next.wave}
        {next.team ? ` · ${next.team.name}` : ""}
      </span>
      {athletes.length ? <span className="station-screen-next-people">{athletes.join(" & ")}</span> : null}
      <span className="pd-num">
        {now !== null ? `${arrivalWallTime(next.inMs, now)} · ` : ""}
        {t("in {time}", { time: countdown(next.inMs) })}
        {next.estimated ? ` (${t("estimated")})` : ""}
      </span>
    </footer>
  );
}
