"use client";

import { BlueprintCard } from "@/components/app/page-shell";
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
  pickable: number[];
  pending: boolean;
  studioName: (studioId: string | null) => string;
  onMove: (teamId: string, wave: number) => void;
  onCycle: (competitorId: string, current: string | null) => void;
};

function TeamGrid(props: TeamGridProps) {
  return (
    <div className="wave-card-teams">
      {props.teams.map((team) => (
        <TeamRow
          key={team.id}
          team={team}
          pickable={props.pickable}
          pending={props.pending}
          studioName={props.studioName}
          onMove={props.onMove}
          onCycle={props.onCycle}
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
  grid: Omit<TeamGridProps, "teams">;
}) {
  const t = useT();

  const window = waveWindowLabel(wave.startTime, wave.durationMinutes);
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

        {isAdmin ? (
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
        <form action={(form) => onSaveSettings(wave, form)} className="wave-card-settings">
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
          <Field
            label={t("Minutes")}
            name="durationMinutes"
            value={wave.durationMinutes}
            min={1}
            max={180}
          />
          <Field label={t("Capacity")} name="capacity" value={wave.capacity} min={1} max={99} />
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

      <TeamGrid {...grid} teams={inWave} />
    </BlueprintCard>
  );
}

export function OrphanCard({
  number,
  inWave,
  grid,
}: {
  number: number;
  inWave: SetupTeam[];
  grid: Omit<TeamGridProps, "teams">;
}) {
  const t = useT();

  return (
    <BlueprintCard style={{ padding: "14px 16px" }}>
      <div className="wave-card-head">
        <div className="wave-card-number">
          {t("Wave")} {number}
        </div>
        <span className="badge badge-warn">{t("Not in the running order")}</span>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {t("These teams have no wave to be started in. Add the wave, or move them.")}
        </div>
      </div>

      <TeamGrid {...grid} teams={inWave} />
    </BlueprintCard>
  );
}
