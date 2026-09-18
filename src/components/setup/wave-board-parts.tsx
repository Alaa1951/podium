"use client";

import { useT } from "@/components/i18n/locale-provider";

/** A team in the running order, and one field of a wave's settings. */
export type SetupTeam = {
  id: string;
  number: number;
  name: string;
  category: string;
  division: string;
  wave: number;
  competitors: { id: string; fullName: string; studioId: string | null }[];
};

export function Field({
  label,
  name,
  value,
  min,
  max,
}: {
  label: string;
  name: string;
  value: number;
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={`${name}-${value}`}>
        {label}
      </label>
      <input
        id={`${name}-${value}`}
        name={name}
        type="number"
        min={min}
        max={max}
        defaultValue={value}
        className="input pd-num"
        style={{ width: 92 }}
        required
      />
    </div>
  );
}

export function TeamRow({
  team,
  pickable,
  pending,
  studioName,
  onMove,
  onCycle,
}: {
  team: SetupTeam;
  pickable: number[];
  pending: boolean;
  studioName: (id: string | null) => string;
  onMove: (teamId: string, wave: number) => void;
  onCycle: (competitorId: string, current: string | null) => void;
}) {
  const t = useT();

  return (
    <div className="setup-team-row"
      style={{
        display: "grid",
        gridTemplateColumns: "38px minmax(0,1fr) auto",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        border: "1px solid var(--border)",
      }}
    >
      <span className="pd-num" style={{ color: "var(--text-secondary)", fontSize: 13 }}>
        {team.number}
      </span>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-heading)",
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          {team.name}
        </div>

        <div className="team-row-bracket">
          <span className="badge badge-cyan">{t(team.category)}</span>
          <span className="badge badge-blue">{t(team.division)}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 3 }}>
          {team.competitors.map((competitor) => (
            <button
              key={competitor.id}
              type="button"
              className="chip-sm"
              data-active={!!competitor.studioId}
              disabled={pending}
              onClick={() => onCycle(competitor.id, competitor.studioId)}
              style={{ textAlign: "start" }}
            >
              {competitor.fullName} · {studioName(competitor.studioId)}
            </button>
          ))}
        </div>
      </div>

      <select
        className="input pd-num"
        aria-label={`${team.name} ${t("Wave")}`}
        value={team.wave}
        disabled={pending}
        onChange={(e) => onMove(team.id, Number(e.target.value))}
        style={{ width: 66, flex: "none", padding: "3px 6px", fontSize: 13 }}
      >
        {pickable.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}
