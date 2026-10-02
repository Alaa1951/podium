"use client";

import type { BoardTeam } from "@/lib/board";
import { fmt } from "@/lib/scoring";
import { teamLabel, type BoardDisplay } from "@/lib/visibility";
import { useT } from "@/components/i18n/locale-provider";

// The pieces the running board is assembled from: its grid, its figures, a
// scored row, a zone cell, and a row of the floor panel. Separated from the
// board itself so that screen is about what it shows rather than how each
// part is drawn.

/**
 * The grid follows the series' definition: rank, team, one column per zone,
 * total. Four was never a property of the board — it was a property of Series 1.
 */
export function columnsFor(zoneCount: number) {
  return `auto minmax(0,2.4fr) repeat(${Math.max(1, zoneCount)}, minmax(0,0.7fr)) minmax(0,1fr)`;
}

export const statLabel: React.CSSProperties = {
  fontFamily: "var(--font-heading), sans-serif",
  fontWeight: 700,
  fontSize: "clamp(9px,1vw,11px)",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--board-text-muted)",
  whiteSpace: "nowrap",
};

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={statLabel}>{label}</div>
      <div
        className="display num"
        style={{ fontSize: "clamp(26px,3vw,46px)", color: "var(--board-text)" }}
      >
        {value}
      </div>
    </div>
  );
}

export function ScoreRow({
  row,
  display,
  index,
  showBracket,
  columns,
}: {
  row: BoardTeam & { rank: number };
  display: BoardDisplay;
  index: number;
  showBracket: boolean;
  columns: string;
}) {
  const t = useT();
  const label = teamLabel({ name: row.name, competitors: row.competitors }, display);
  // As on the reference board: bracket · wave · athletes · team number.
  const sub = [
    showBracket ? `${t(row.category)} ${t(row.division)}` : null,
    row.wave !== null ? `W${row.wave}` : null,
    label.secondary,
    `${t("Team")} ${row.number}`,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <div
      className="board-row zone-row rise"
      data-rank={row.rank <= 3 ? row.rank : undefined}
      style={{
        gridTemplateColumns: columns,
        gap: 12,
        padding: "6px 14px",
        animationDelay: `${Math.min(index, 10) * 16}ms`,
      }}
    >
      <div className="rank-disc num" data-rank={row.rank <= 3 ? row.rank : undefined}>
        {row.rank}
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          className="truncate"
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontWeight: 700,
            fontSize: "clamp(14px,1.35vw,17px)",
            color: "var(--board-text)",
          }}
        >
          {label.primary}
        </div>
        <div
          className="truncate"
          style={{ fontSize: "clamp(11px,1.1vw,12px)", color: "var(--board-text-muted)" }}
        >
          {sub}
        </div>
      </div>

      {row.zones.map((zone) => (
        // Whole points get no decimals, fractions get two — so a column of
        // 4,860 and 32.21 stays readable instead of all being .00. A zone its
        // judge has not submitted yet is a dash.
        <Zone
          key={zone.number}
          value={zone.submitted ? fmt(zone.points, Number.isInteger(zone.points) ? 0 : 2) : "—"}
        />
      ))}

      <div
        className="display num"
        style={{
          fontSize: "clamp(16px,1.8vw,24px)",
          color: "var(--board-text)",
          textAlign: "end",
          whiteSpace: "nowrap",
        }}
      >
        {fmt(row.total, 2)}
      </div>
    </div>
  );
}

function Zone({ value }: { value: string }) {
  return (
    <div
      className="zone-col num"
      style={{
        textAlign: "end",
        fontSize: "clamp(11px,1.1vw,14px)",
        color: "var(--board-text-muted)",
        overflow: "hidden",
      }}
    >
      {value}
    </div>
  );
}

export function FloorRow({
  team,
  display,
}: {
  team: BoardTeam;
  display: BoardDisplay;
}) {
  const t = useT();
  const label = teamLabel({ name: team.name, competitors: team.competitors }, display);

  return (
    <div
      data-testid="floor-row"
      data-team={team.number}
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0,1fr) auto",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderTop: "1px solid var(--board-border)",
        opacity: team.scored ? 1 : 0.45,
      }}
    >
      <div
        className="display num"
        style={{
          fontSize: 12,
          color: "var(--board-text-muted)",
        }}
        title={t("Station")}
      >
        {team.station ? `${t("Station")} ${team.station}` : "·"}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          className="truncate"
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontWeight: 700,
            fontSize: 15,
            color: "var(--board-text)",
          }}
        >
          {label.primary}
        </div>
        <div
          className="truncate"
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--board-text-muted)",
          }}
        >
          {t(team.category)} {t(team.division)}
          {` · ${t("Team")} ${team.number}`}
        </div>
      </div>
      <div
        className="display num"
        style={{ fontSize: 17, color: "var(--board-text)", whiteSpace: "nowrap" }}
      >
        {team.scored ? fmt(team.total, 2) : "—"}
      </div>
    </div>
  );
}
