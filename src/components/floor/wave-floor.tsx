"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { controlWave } from "@/lib/actions/waves";
import {
  stationSlots,
  waveLengthMinutes,
  wavePosition,
  zoneOneFreeAt,
  zoneWindows,
  type FloorTiming,
} from "@/lib/floor";
import type { WaveState } from "@/lib/waves";

// ─────────────────────────────────────────────────────────────────────────────
// THE FLOOR, FOR THE SUPERVISOR.
//
// Top: which wave is in which zone right now. Below: one card per wave with
// its stations — as many as that wave's capacity, not the floor's nine —
// where it is in its rotation, and the three buttons —
// Start (only once Zone 1 is free), End now (emergencies), Reset. Everything
// time-related is worked out here from when each wave started, with the same
// arithmetic the server uses (src/lib/floor.ts), and the page re-reads the
// server every few seconds while anything is on the floor.
// ─────────────────────────────────────────────────────────────────────────────

export type FloorTeam = { id: string; number: number; name: string; station: number | null };

const ERRORS: Record<string, string> = {
  NO_TEAMS: "This wave has no teams yet.",
  STATIONS_MISSING: "Every team in the wave needs a station before it can start.",
  NO_ZONES: "This competition has no zones yet — add them in Settings.",
  SERIES_NOT_LIVE: "Set the competition to Running before starting a wave.",
  ALREADY_STARTED: "This wave has already started.",
  NOT_RUNNING: "This wave is not on the floor.",
  FORBIDDEN: "You are not allowed to do that.",
};

function clock(ms: number | null) {
  if (ms === null) return "--:--";
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function WaveFloor({
  waves,
  teamsByWave,
  zones,
  timing,
  canControl,
}: {
  waves: WaveState[];
  teamsByWave: Record<string, FloorTeam[]>;
  zones: { id: string; number: number; name: string }[];
  timing: FloorTiming;
  canControl: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  // The wall clock lives in state so every render is pure; the first render
  // (server and browser alike) shows placeholders.
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

  const anyRunning = waves.some((wave) => wave.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const poll = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(poll);
  }, [anyRunning, router]);

  const at = now === null ? null : new Date(now);
  const started = (wave: WaveState) => (wave.startedAt ? new Date(wave.startedAt) : null);
  const runningStarts = waves.filter((wave) => wave.status === "running").map((wave) => ({ startedAt: started(wave) }));
  const freeAt = at ? zoneOneFreeAt(runningStarts, timing, at) : null;
  const freeInMs = freeAt && at ? freeAt.getTime() - at.getTime() : 0;

  function run(waveId: string, action: "start" | "finish" | "reset") {
    if (action === "finish" && !window.confirm(t("End this wave now? Teams not stopped keep the time left on the clock."))) return;
    if (action === "reset" && !window.confirm(t("Put this wave back to not started? Scores already entered are kept."))) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await controlWave({ waveId, action });
        if (!result.ok) {
          setError(
            result.error === "ZONE_OCCUPIED"
              ? t("Zone 1 is still busy — free in {time}.", { time: clock(result.freeInMs ?? 0) })
              : t(ERRORS[result.error] ?? "Something went wrong. Try again.")
          );
        }
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  const zoneName = (index: number | null) => {
    if (index === null) return "";
    const zone = zones[index];
    return zone ? `${t("Zone")} ${zone.number}` : "";
  };

  return (
    <>
      {error ? (
        <div className="notice-error" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>{t("On the floor now")}</h2>
          <span className="reg-sub pd-num">
            {t("{minutes} min per wave", { minutes: waveLengthMinutes(timing) })} ·{" "}
            {freeInMs > 0 ? t("Zone 1 free in {time}", { time: clock(freeInMs) }) : t("Zone 1 is free")}
          </span>
        </div>
        <div className="floor-map">
          {zones.map((zone, index) => {
            const here = at
              ? waves
                  .map((wave) => ({ wave, position: wavePosition({ startedAt: started(wave), completed: wave.status !== "running" }, timing, at) }))
                  .find(({ position }) => (position.phase === "work" || position.phase === "break") && position.zoneIndex === index)
              : undefined;
            return (
              <div key={zone.id} className="floor-zone" data-phase={here?.position.phase ?? "empty"}>
                <div className="floor-zone-name">
                  {t("Zone")} {zone.number} · {t(zone.name)}
                </div>
                {here ? (
                  <div className="floor-zone-wave">
                    <strong>
                      {t("Wave")} {here.wave.number}
                    </strong>
                    <span className="pd-num">
                      {here.position.phase === "work" ? t("Working") : t("Changing zones")} · {clock(here.position.phaseRemainingMs)}
                    </span>
                  </div>
                ) : (
                  <div className="reg-sub">{t("Empty")}</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="floor-waves">
        {waves.map((wave) => {
          const position = at
            ? wavePosition({ startedAt: started(wave), completed: wave.status !== "running" }, timing, at)
            : null;
          const teams = teamsByWave[wave.id] ?? [];
          // The strip is the WAVE's capacity, not the floor's nine — and never
          // shorter than the highest station in use, so a capacity lowered
          // under a placed wave shows the teams standing off the end.
          const slots = stationSlots(wave.capacity, teams.map((team) => team.station));
          const stations = Array.from({ length: slots }, (_, index) =>
            teams.find((team) => team.station === index + 1)
          );
          const unplaced = teams.filter((team) => team.station === null);
          const beyond = teams.filter((team) => team.station !== null && team.station > wave.capacity);
          const badge =
            wave.status === "running"
              ? { tone: "badge-live", label: t("On the floor") }
              : wave.status === "complete"
                ? { tone: "badge-ok", label: t("Complete") }
                : { tone: "badge-neutral", label: t("Not started") };
          const windows = zoneWindows(timing);
          const total = waveLengthMinutes(timing) * 60_000 || 1;
          const elapsed = position && wave.startedAt && at ? at.getTime() - new Date(wave.startedAt).getTime() : 0;

          return (
            <section key={wave.id} className="card floor-wave" data-status={wave.status}>
              <div className="floor-wave-head">
                <strong className="floor-wave-number">
                  {t("Wave")} {wave.number}
                </strong>
                <span className={`badge ${badge.tone}`}>{badge.label}</span>
                <span className="reg-sub pd-num">
                  {wave.startTime} · {teams.length}/{wave.capacity}
                </span>
                {wave.status === "running" && position ? (
                  <span className="pd-num floor-wave-now">
                    {position.phase === "work"
                      ? t("{zone} · working · {time} left", { zone: zoneName(position.zoneIndex), time: clock(position.phaseRemainingMs) })
                      : position.phase === "break"
                        ? t("Changing zones · {time}", { time: clock(position.phaseRemainingMs) })
                        : t("Finishing")}
                    {" · "}
                    {t("wave {time}", { time: clock(position.waveRemainingMs) })}
                  </span>
                ) : null}
              </div>

              {wave.status === "running" ? (
                <div className="zone-track" aria-hidden>
                  {windows.map((window) => (
                    <span
                      key={window.index}
                      className="zone-track-seg"
                      data-state={elapsed >= window.workEndMs ? "done" : elapsed >= window.workStartMs ? "now" : "next"}
                      style={{ flex: (window.breakEndMs - window.workStartMs) / total }}
                    >
                      {zoneName(window.index)}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="station-strip">
                {stations.map((team, index) => (
                  <div
                    key={index}
                    className="station-cell"
                    data-empty={!team || undefined}
                    data-beyond={index + 1 > wave.capacity || undefined}
                  >
                    <span className="station-number">{index + 1}</span>
                    <span className="station-team">{team ? `${team.number} · ${team.name}` : "—"}</span>
                  </div>
                ))}
              </div>
              {beyond.length ? (
                <p className="notice-error" style={{ marginTop: 8 }}>
                  {t("Over capacity by {n}.", { n: beyond.length })}{" "}
                  {t("Past station {capacity}: {teams}", {
                    capacity: wave.capacity,
                    teams: beyond.map((team) => team.number).join(", "),
                  })}
                </p>
              ) : null}
              {unplaced.length ? (
                <p className="notice-error" style={{ marginTop: 8 }}>
                  {t("Without a station: {teams}", { teams: unplaced.map((team) => team.number).join(", ") })}
                </p>
              ) : null}

              {canControl ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {wave.status === "pending" ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={pending || teams.length === 0 || freeInMs > 0}
                      onClick={() => run(wave.id, "start")}
                    >
                      {freeInMs > 0 ? t("Start · Zone 1 free in {time}", { time: clock(freeInMs) }) : t("Start wave")}
                    </button>
                  ) : null}
                  {wave.status === "running" ? (
                    <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => run(wave.id, "finish")}>
                      {t("End now")}
                    </button>
                  ) : null}
                  {wave.status !== "pending" ? (
                    <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => run(wave.id, "reset")}>
                      {t("Reset")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
        {waves.length === 0 ? <p className="reg-sub">{t("No waves yet. Build the running order on the Waves screen.")}</p> : null}
      </div>
    </>
  );
}
