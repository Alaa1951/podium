"use client";

import { useMemo, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import type { BoardPayload } from "@/lib/board";
import { clockFromMs } from "@/lib/scoring";
import { teamLabel, type BoardDisplay } from "@/lib/visibility";
import { useBoardClock } from "@/components/board/use-board-clock";
import { SponsorStrip } from "@/components/board/sponsor-strip";

// LIVE BOARD 2 — THE ROOM, ZONE BY ZONE.
//
// Board 1 is standings. This one is a map of the floor: one column per zone,
// the zone's stations down its length, and on every station the team standing
// on it right now and the wave it came with. The room reads it the way the
// room is built — find your zone, walk to your station.
//
// Zones are occupied by rotation: each running wave sits in one zone at a
// time (the floor's own schedule moves it along), so the board shows WHO is
// in each zone because it shows WHICH wave is in each zone. When a wave
// finishes and the next one starts behind it, the map changes with them —
// both come from the same poll.

export function FloorBoard({
  initial,
  display,
  seriesLabel,
  pollHref,
}: {
  initial: BoardPayload;
  display: BoardDisplay;
  seriesLabel: string;
  /** Polls a custom endpoint when set — the public wall's phase-gated API. */
  pollHref?: string;
}) {
  const t = useT();
  const [data, setData] = useState(initial);
  const { sinceRefresh } = useBoardClock(data, initial.seriesId, setData, pollHref);

  const running = data.waves.filter((wave) => wave.status === "running" && wave.startedAt);

  // Which wave each zone is working with right now. Two waves can touch the
  // same zone for the minute of a changeover; the one that started later is
  // the one the floor handed the zone to next.
  const zoneWave = useMemo(() => {
    const map = new Map<number, (typeof running)[number]>();
    for (const wave of [...running].sort(
      (a, b) => Date.parse(b.startedAt ?? "") - Date.parse(a.startedAt ?? "")
    )) {
      if (wave.floor.zoneNumber) map.set(wave.floor.zoneNumber, wave);
    }
    return map;
  }, [running]);

  // The stations on the wall: whatever the floor is using, at least six. A
  // venue that rigs more stations sees more rows without a code change.
  const stationCount = useMemo(() => {
    const inUse = running.flatMap((wave) =>
      data.teams.filter((team) => team.wave === wave.number).map((team) => team.station ?? 0)
    );
    return Math.max(6, ...inUse, 1);
  }, [running, data.teams]);

  const teamsByWaveStation = useMemo(() => {
    const map = new Map<string, BoardPayload["teams"][number]>();
    for (const team of data.teams) {
      if (team.wave !== null && team.station !== null) {
        map.set(`${team.wave}:${team.station}`, team);
      }
    }
    return map;
  }, [data.teams]);

  const nextWave = running.length === 0 ? data.nextWave : null;
  const nextStartsIn = nextWave?.startsInMs == null ? null : nextWave.startsInMs;

  return (
    <div className="board floorboard" data-testid="floorboard">
      <div className="floorboard-top">
        <div>
          <div className="floorboard-series">{seriesLabel}</div>
          <div className="floorboard-kicker">
            {running.length > 0 ? t("On the floor now") : t("Up next")}
          </div>
        </div>
        <div className="floorboard-top-side">
          {nextWave ? (
            <div className="floorboard-next">
              {t("Wave")} {nextWave.number}
              {nextStartsIn !== null && nextStartsIn > 0 ? ` · ${clockFromMs(nextStartsIn)}` : ""}
            </div>
          ) : null}
          <div className="floorboard-updated">
            {t("Updated")} {sinceRefresh}s {t("ago")}
          </div>
        </div>
      </div>

      <div className="floorboard-zones">
        {data.zoneDefs.map((zone) => {
          const wave = zoneWave.get(zone.number);
          const changing = wave?.floor.phase === "break";
          return (
            <section key={zone.id} className="floorzone" data-testid={`floorzone-${zone.number}`}>
              <header className="floorzone-head">
                <div>
                  <div className="floorzone-number display">{t("Zone")} {zone.number}</div>
                  <div className="floorzone-name">{zone.name}</div>
                </div>
                <div className="floorzone-wave" data-changing={changing || undefined}>
                  {wave ? `${t("Wave")} ${wave.number}` : "—"}
                </div>
              </header>
              <div className="floorzone-rows">
                {Array.from({ length: stationCount }, (_, i) => i + 1).map((station) => {
                  const team = wave
                    ? teamsByWaveStation.get(`${wave.number}:${station}`)
                    : undefined;
                  const label = team
                    ? teamLabel({ name: team.name, competitors: team.competitors }, display)
                    : null;
                  return (
                    <div key={station} className="floorzone-row" data-team={team?.number ?? undefined}>
                      <span className="floorzone-station num">{station}</span>
                      {team ? (
                        <>
                          <span className="floorzone-teamwrap">
                            <span className="floorzone-team truncate">{label?.primary}</span>
                            {label?.secondary ? (
                              <span className="floorzone-crew truncate">{label.secondary}</span>
                            ) : null}
                          </span>
                          <span className="floorzone-totals">
                            <span className="floorzone-wavebadge">{t("Wave")} {team.wave}</span>
                            <span className="floorzone-total num">{team.scored ? team.total : "—"}</span>
                          </span>
                        </>
                      ) : (
                        <span className="floorzone-empty">{t("No team")}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <SponsorStrip enabled={data.sponsorsEnabled} logos={data.sponsors} />
    </div>
  );
}
