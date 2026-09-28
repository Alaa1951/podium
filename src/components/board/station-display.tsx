"use client";

import { useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { useBoardClock } from "@/components/board/use-board-clock";
import type { BoardPayload } from "@/lib/board";
import { DEFAULT_ATHLETE_PHOTO } from "@/lib/athlete-photo";
import { remainingClock } from "@/lib/floor";
import { nextOnStation, stationView, zoneStations, type StationView } from "@/lib/stations";

type UpNext = ReturnType<typeof nextOnStation>;

/** "12:05" for a countdown on a wall screen. */
function countdown(ms: number) {
  const { minutes, seconds } = remainingClock(ms);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
  // Nobody on the rig: say who is coming, so the pair can be called over
  // before their clock starts. Older payloads (a cached page) have no list.
  const next =
    view.state === "idle"
      ? nextOnStation({ upNext: data.upNext ?? [], teams: data.teams, zoneNumber, station, elapsedMs })
      : null;

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
    </div>
  );
}

function StationBody({ view, next }: { view: StationView; next: UpNext }) {
  const t = useT();

  if (view.state === "idle") {
    if (next?.team) {
      return (
        <div className="station-screen-body">
          <span className="station-screen-wave">
            {t("Up next")} · {t("Wave")} {next.wave}
          </span>
          <h1 className="station-screen-team display">{next.team.name}</h1>
          <p className="station-screen-idle">
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
