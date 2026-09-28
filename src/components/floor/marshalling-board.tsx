"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { setAttendance } from "@/lib/actions/payments";
import { stationSlots } from "@/lib/floor";

// ─────────────────────────────────────────────────────────────────────────────
// THE MARSHALLING BOARD. Countdowns tick here every second; the page re-reads
// the server every ten seconds so a wave that starts, ends or is reset
// reaches it by itself. Check-in is the only button, for those who hold it.
// ─────────────────────────────────────────────────────────────────────────────

export type MarshallingTeam = {
  id: string;
  number: number;
  name: string;
  station: number | null;
  athletes: string[];
  studio: string | null;
  checkedIn: boolean;
  /** Paid and holding a place — only these appear on the rig screens and the board. */
  competing: boolean;
};

type Plan = {
  zones: {
    zoneIndex: number;
    current: { waveId: string; phase: "work" | "break"; endsAt: string } | null;
    next: { waveId: string; arrivesAt: string; estimated: boolean } | null;
  }[];
  moves: { waveId: string; toZoneIndex: number | null; at: string }[];
  callUp: { waveId: string; startsAt: string; estimated: boolean; overdue: boolean }[];
};

function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${String(minutes).padStart(2, "0")}:${seconds}`;
}

const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Qatar", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const wallTime = (iso: string) => timeFormat.format(new Date(iso));

/** One wave's stations: who stands where, and whether they have checked in. */
function Strip({
  teams,
  capacity,
  withCheckIn,
  pending,
  onCheckIn,
}: {
  teams: MarshallingTeam[];
  capacity: number;
  /** Check-in buttons, for someone who holds check-in. */
  withCheckIn: boolean;
  pending: boolean;
  onCheckIn: (team: MarshallingTeam) => void;
}) {
  const t = useT();
  const slots = stationSlots(capacity, teams.map((team) => team.station));
  const unplaced = teams.filter((team) => team.station === null);
  // Only the rigs somebody stands on — the call-up is a list of names to
  // shout, and seven empty rows push them off the screen.
  const rows = [
    ...Array.from({ length: slots }, (_, index) => ({ station: index + 1, team: teams.find((row) => row.station === index + 1) })).filter(
      (row) => row.team
    ),
    ...unplaced.map((team) => ({ station: null as number | null, team })),
  ];
  const checked = teams.filter((team) => team.checkedIn).length;
  return (
    <>
      <p className="reg-sub pd-num" style={{ margin: "4px 0 8px" }}>
        {t("{checked} of {total} checked in", { checked, total: teams.length })}
      </p>
      <div className="marshal-strip">
        {rows.map(({ station, team }, index) => (
          <div key={team?.id ?? `empty-${index}`} className="marshal-cell" data-empty={!team || undefined}>
            <span className="station-number">{station ?? "?"}</span>
            {team ? (
              <div className="marshal-cell-body">
                <div className="marshal-cell-team">
                  <strong>#{team.number}</strong> {team.name}
                </div>
                <div className="reg-sub">{team.athletes.join(" · ")}</div>
                {team.studio ? <div className="reg-sub">{team.studio}</div> : null}
                <div className="chip-row" style={{ marginTop: 4 }}>
                  {team.checkedIn ? (
                    <span className="badge badge-ok">{t("Checked in")}</span>
                  ) : (
                    <span className="badge badge-warn">{t("Not checked in")}</span>
                  )}
                  {!team.competing ? <span className="badge badge-danger">{t("Unpaid — not on the rig screen")}</span> : null}
                  {withCheckIn ? (
                    <button type="button" className="btn btn-sm btn-secondary" disabled={pending} onClick={() => onCheckIn(team)}>
                      {team.checkedIn ? t("Undo check-in") : t("Check in")}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <span className="reg-sub">—</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}


export function MarshallingBoard({
  zones,
  waves,
  teamsByWave,
  plan,
  canCheckIn,
  rigBase,
}: {
  zones: { number: number; name: string }[];
  waves: Record<string, { number: number; capacity: number }>;
  teamsByWave: Record<string, MarshallingTeam[]>;
  plan: Plan;
  canCheckIn: boolean;
  rigBase: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setNow(Date.now());
    });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 10_000);
    return () => {
      active = false;
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [router]);

  const inTime = (iso: string) => (now === null ? "" : ` · ${t("in {time}", { time: clock(new Date(iso).getTime() - now) })}`);
  const waveLabel = (waveId: string) => `${t("Wave")} ${waves[waveId]?.number ?? "?"}`;
  const zoneLabel = (index: number) => `${t("Zone")} ${zones[index]?.number ?? index + 1}`;

  function checkIn(team: MarshallingTeam) {
    setError("");
    startTransition(async () => {
      try {
        const result = await setAttendance({ teamId: team.id, attended: !team.checkedIn });
        if (!result.ok) setError(t("Could not save. Check your connection and try again."));
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  return (
    <div className="marshal">
      {error ? (
        <div className="notice-error" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <h2 className="section-title">{t("Zones now")}</h2>
      <div className="marshal-zones">
        {plan.zones.map((zone) => (
          <div key={zone.zoneIndex} className="card marshal-zone" data-busy={zone.current ? "true" : undefined}>
            <div className="card-kicker">
              {zoneLabel(zone.zoneIndex)} · {t(zones[zone.zoneIndex]?.name ?? "")}
            </div>
            {zone.current ? (
              <div className="pd-num">
                <strong>{waveLabel(zone.current.waveId)}</strong> ·{" "}
                {zone.current.phase === "work" ? t("Working") : t("Changing zones")}
                {inTime(zone.current.endsAt)}
              </div>
            ) : (
              <div className="reg-sub">{t("Empty")}</div>
            )}
            {zone.next ? (
              <div className="reg-sub pd-num">
                {t("Next in: {wave} at {time}", { wave: waveLabel(zone.next.waveId), time: wallTime(zone.next.arrivesAt) })}
                {zone.next.estimated ? ` (${t("estimated")})` : ""}
                {inTime(zone.next.arrivesAt)}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {plan.moves.length ? (
        <>
          <h2 className="section-title">{t("Moving next")}</h2>
          {plan.moves.map((move) => (
            <section key={move.waveId} className="card" style={{ marginBottom: 12 }}>
              <div className="marshal-move pd-num">
                <strong>{waveLabel(move.waveId)}</strong>
                <span>
                  {move.toZoneIndex === null
                    ? t("finishes at {time}", { time: wallTime(move.at) })
                    : t("→ {zone} at {time}", { zone: zoneLabel(move.toZoneIndex), time: wallTime(move.at) })}
                  {inTime(move.at)}
                </span>
              </div>
              <details>
                <summary className="reg-sub">{t("Stations")}</summary>
                <Strip
                  teams={teamsByWave[move.waveId] ?? []}
                  capacity={waves[move.waveId]?.capacity ?? 0}
                  withCheckIn={false}
                  pending={pending}
                  onCheckIn={checkIn}
                />
              </details>
            </section>
          ))}
        </>
      ) : null}

      <h2 className="section-title">{t("Call-up")}</h2>
      {plan.callUp.length === 0 ? <p className="reg-sub">{t("No more waves to call up.")}</p> : null}
      {plan.callUp.map((row, index) => (
        <section key={row.waveId} className="card" style={{ marginBottom: 12 }} data-first={index === 0 || undefined}>
          <div className="marshal-move pd-num">
            <strong>{waveLabel(row.waveId)}</strong>
            <span>
              {t("starts about {time} — gather at Zone 1", { time: wallTime(row.startsAt) })}
              {row.overdue ? ` · ${t("behind schedule")}` : ""}
              {inTime(row.startsAt)}
            </span>
          </div>
          <Strip
            teams={teamsByWave[row.waveId] ?? []}
            capacity={waves[row.waveId]?.capacity ?? 0}
            withCheckIn={canCheckIn}
            pending={pending}
            onCheckIn={checkIn}
          />
        </section>
      ))}

      {zones.length ? (
        <>
          <h2 className="section-title">{t("Screens for the floor")}</h2>
          <p className="reg-sub">{t("Open one on the screen above each rig. It follows the wave in that zone by itself.")}</p>
          <div className="marshal-rigs">
            {zones.map((zone) => (
              <div key={zone.number} className="marshal-rig-zone">
                <Link href={`${rigBase}/zone/${zone.number}/stations`} className="btn btn-secondary btn-sm">
                  {t("Zone")} {zone.number}
                </Link>
                <div className="chip-row">
                  {Array.from({ length: Math.max(1, ...Object.values(waves).map((wave) => wave.capacity)) }, (_, index) => (
                    <Link key={index} href={`${rigBase}/station/${zone.number}/${index + 1}`} className="chip chip-sm">
                      {index + 1}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
