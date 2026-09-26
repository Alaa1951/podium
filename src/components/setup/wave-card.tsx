"use client";

import { BlueprintCard } from "@/components/app/page-shell";
import { useState } from "react";
import { useUnsavedChanges } from "@/components/app/mobile-runtime";
import { useT } from "@/components/i18n/locale-provider";
import { Field, TeamRow, type SetupTeam } from "@/components/setup/wave-board-parts";
import { waveWindowLabel, type WaveState } from "@/lib/waves";

// ─────────────────────────────────────────────────────────────────────────────
// ONE WAVE ON THE RUNNING ORDER.
//
// Its head says when it runs and how full it is; its body is the teams in it.
// An ORPHAN card is the same thing for teams pointing at a wave that is not in
// the running order at all — they are not lost, and they must not be silently
// dropped from the screen either.
// ─────────────────────────────────────────────────────────────────────────────

type TeamGridProps = {
  teams: SetupTeam[];
  /** The wave's capacity — how many stations its team rows may offer. */
  stations: number;
  pickable: number[];
  pending: boolean;
  /** Whether the studio chips may be pressed (registrations.edit). */
  canEditTeams: boolean;
  studioName: (studioId: string | null) => string;
  onMove: (teamId: string, wave: number) => void;
  onCycle: (competitorId: string, current: string | null) => void;
  onStation?: (teamId: string, station: number) => void;
};

function TeamGrid(props: TeamGridProps) {
  return (
    <div className="wave-card-teams">
      {[...props.teams].sort((a, b) => (a.station ?? 99) - (b.station ?? 99)).map((team) => (
        <TeamRow
          key={team.id}
          team={team}
          stations={props.stations}
          pickable={props.pickable}
          pending={props.pending}
          canEditTeams={props.canEditTeams}
          studioName={props.studioName}
          onMove={props.onMove}
          onCycle={props.onCycle}
          onStation={props.onStation}
        />
      ))}
    </div>
  );
}

export function WaveCard({
  wave,
  inWave,
  isAdmin,
  pending,
  editing,
  onToggleSettings,
  onRemove,
  onSaveSettings,
  grid,
}: {
  wave: WaveState;
  inWave: SetupTeam[];
  isAdmin: boolean;
  pending: boolean;
  editing: boolean;
  onToggleSettings: () => void;
  onRemove: () => void;
  onSaveSettings: (wave: WaveState, form: FormData) => void;
  grid: Omit<TeamGridProps, "teams" | "stations">;
}) {
  const t = useT();

  const window = waveWindowLabel(wave.startTime, wave.durationMinutes);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(editing && dirty);
  const over = inWave.length > wave.capacity;
  const brackets = [...new Set(inWave.map((team) => `${team.category} ${team.division}`))];

  const status =
    wave.status === "running"
      ? { tone: "badge-live", label: t("On the floor") }
      : wave.status === "complete"
        ? { tone: "badge-ok", label: t("Complete") }
        : { tone: "badge-neutral", label: t("Not started") };

  return (
    <BlueprintCard style={{ padding: "14px 16px" }}>
      <div className="wave-card-head">
        <div className="wave-card-number">
          {t("Wave")} {wave.number}
        </div>

        <span className={`badge ${status.tone}`}>{status.label}</span>

        <div className="pd-num wave-card-window">
          {window.start} – {window.end} · {wave.durationMinutes} {t("min")}
        </div>

        <div className="wave-card-fill" data-over={over || undefined}>
          {inWave.length} / {wave.capacity}
          {over ? ` · ${t("OVER CAPACITY")}` : ""}
          {inWave.length
            ? ` · ${brackets.length > 2 ? `${brackets.length} brackets` : brackets.join(" + ")}`
            : ""}
        </div>

        {isAdmin && wave.status === "pending" ? (
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="chip-sm" disabled={pending} onClick={onToggleSettings}>
              {editing ? t("Close") : t("Settings")}
            </button>
            {wave.status === "pending" && inWave.length === 0 ? (
              <button type="button" className="chip-sm" disabled={pending} onClick={onRemove}>
                {t("Remove")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {isAdmin && editing ? (
        <form onInput={() => setDirty(true)} action={(form) => onSaveSettings(wave, form)} className="wave-card-settings">
          <Field label={t("Wave")} name="number" value={wave.number} min={1} max={99} />
          <div>
            <label className="field-label" htmlFor={`start-${wave.id}`}>
              {t("Starts")}
            </label>
            <input
              id={`start-${wave.id}`}
              name="startTime"
              type="time"
              defaultValue={wave.startTime}
              className="input pd-num"
              style={{ width: 120 }}
              required
            />
          </div>
          <button type="submit" className="btn btn-secondary" disabled={pending}>
            {t("Save wave")}
          </button>
        </form>
      ) : null}

      {inWave.length === 0 ? (
        <div className="wave-card-empty">
          {t("Empty — set any team's wave dropdown to move it here.")}
        </div>
      ) : null}

      <TeamGrid {...grid} teams={inWave} stations={wave.capacity} />
    </BlueprintCard>
  );
}

export function OrphanCard({
  inWave,
  stations,
  grid,
}: {
  number: number;
  inWave: SetupTeam[];
  /**
   * The COMPETITION's capacity. These teams point at a wave that does not
   * exist, so there is no wave capacity to read — and the wave somebody
   * eventually creates for them will be built with this number.
   */
  stations: number;
  grid: Omit<TeamGridProps, "teams" | "stations">;
}) {
  const t = useT();

  return (
    <BlueprintCard style={{ padding: "14px 16px" }}>
      <div className="wave-card-head">
        {/* NOT "Wave {n}". This bucket is not a wave — it is the teams that
            point at one which does not exist. Headed with the number, it reads
            as a real wave sitting among the real ones, and on a screen that
            already lists Wave 1, Wave 2, Wave 3 that is a trap for the eye. */}
        <div className="wave-card-number">{t("Unscheduled")}</div>
        <span className="badge badge-warn">{t("Not in the running order")}</span>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {t(
            "These teams have not been assigned to a wave. Choose a wave to place them."
          )}
        </div>
      </div>

      <TeamGrid {...grid} teams={inWave} stations={stations} />
    </BlueprintCard>
  );
}
