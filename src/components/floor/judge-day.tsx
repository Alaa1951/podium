"use client";

import { useEffect, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import type { JudgeDay as JudgeDayView, JudgeDayRow, JudgeDayTeam } from "@/lib/judge-day";

// ─────────────────────────────────────────────────────────────────────────────
// THE JUDGE'S DAY, on the judge sheet above the scoring card.
//
// Where they stand, the next wave coming to them with a countdown and the
// pair on their station, then the whole day's list. It ticks every second on
// its own; the sheet re-reads the server every few seconds (SheetRefresher),
// so a wave that starts, ends or is reset reaches it by itself.
// ─────────────────────────────────────────────────────────────────────────────

function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${String(minutes).padStart(2, "0")}:${seconds}`;
}

const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Qatar", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const wallTime = (iso: string) => timeFormat.format(new Date(iso));

function TeamLine({ team, t, showStation }: { team: JudgeDayTeam; t: ReturnType<typeof useT>; showStation: boolean }) {
  return (
    <div className="judge-day-team">
      <div className="judge-day-team-name">
        {showStation ? <span className="station-number">{team.station ?? "—"}</span> : null}
        <strong>#{team.number}</strong> {team.name ?? ""}
      </div>
      {team.athletes.length ? <div className="reg-sub">{team.athletes.join(" · ")}</div> : null}
      <div className="chip-row" style={{ marginTop: 4 }}>
        {team.checkedIn ? (
          <span className="badge badge-ok">{t("Checked in")}</span>
        ) : (
          <span className="badge badge-warn">{t("Not checked in")}</span>
        )}
        {!team.competing ? <span className="badge badge-danger">{t("Unpaid — not on the rig screen")}</span> : null}
      </div>
    </div>
  );
}

export function JudgeDay({ day }: { day: JudgeDayView }) {
  const t = useT();
  // The wall clock lives in state so every render is pure; the first render
  // (server and browser alike) shows no countdown.
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

  const next = day.rows.find((row) => row.state === "coming") ?? null;
  const here = day.rows.find((row) => row.state === "here") ?? null;

  const when = (row: JudgeDayRow) => {
    const at = wallTime(row.workStartsAt);
    if (row.state !== "coming") return at;
    if (row.estimated && row.overdue) return t("about {time} · behind schedule", { time: at });
    return row.estimated ? t("about {time}", { time: at }) : at;
  };

  return (
    <div className="judge-day">
      <div className="judge-day-post">
        {day.station
          ? t("You are on Zone {zone} · Station {station}", { zone: day.zoneNumber, station: day.station })
          : t("You are on Zone {zone} · every station", { zone: day.zoneNumber })}
      </div>

      {next ? (
        <div className="card judge-day-next">
          <div className="card-kicker">{here ? t("After this wave") : t("Coming to you next")}</div>
          <div className="judge-day-next-head">
            <strong>
              {t("Wave")} {next.number}
            </strong>
            <span className="pd-num">
              {when(next)}
              {now !== null ? ` · ${t("in {time}", { time: clock(new Date(next.workStartsAt).getTime() - now) })}` : ""}
            </span>
          </div>
          {next.estimated ? (
            <p className="reg-sub">{t("Estimated: the wave has not started. It moves if the floor runs late.")}</p>
          ) : null}
          {next.teams.length ? (
            next.teams.map((team) => <TeamLine key={team.id} team={team} t={t} showStation={day.allStations} />)
          ) : (
            <p className="reg-sub">{day.allStations ? t("No team in this wave.") : t("No team on your station in this wave.")}</p>
          )}
        </div>
      ) : (
        <p className="reg-sub">{t("No more waves are coming to your zone today.")}</p>
      )}

      {day.namesHidden ? (
        <p className="reg-sub">{t("Team names appear here once the competition starts.")}</p>
      ) : null}

      <details className="judge-day-list" open={day.rows.length <= 12}>
        <summary>{t("Your day · {count} waves", { count: day.rows.length })}</summary>
        <ol>
          {day.rows.map((row) => (
            <li key={row.waveId} className={`judge-day-row is-${row.state}${row === next ? " is-next" : ""}`}>
              <div className="judge-day-row-head">
                <strong>
                  {t("Wave")} {row.number}
                </strong>
                <span className="pd-num">{when(row)}</span>
                <span className="badge badge-neutral">
                  {row.state === "here" ? t("In your zone") : row.state === "done" ? t("Done") : row === next ? t("Next") : t("Later")}
                </span>
              </div>
              {row.teams.length ? (
                row.teams.map((team) => (
                  <div key={team.id} className="reg-sub">
                    {day.allStations ? `${t("Station {station}", { station: team.station ?? "—" })} · ` : ""}#{team.number}
                    {team.name ? ` ${team.name}` : ""}
                    {team.athletes.length ? ` — ${team.athletes.join(" · ")}` : ""}
                    {team.checkedIn ? "" : ` · ${t("Not checked in")}`}
                  </div>
                ))
              ) : (
                <div className="reg-sub">{day.allStations ? t("No team in this wave.") : t("No team on your station in this wave.")}</div>
              )}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
