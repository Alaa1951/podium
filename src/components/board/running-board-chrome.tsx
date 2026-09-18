"use client";

import { useT } from "@/components/i18n/locale-provider";
import { FloorRow, Stat, statLabel } from "@/components/board/running-board-parts";
import type { BoardTeam } from "@/lib/board";
import { FLOOR_ROTATE_SECONDS } from "@/lib/waves";
import { BRACKETS } from "@/lib/scoring";
import { FilterSheet } from "@/components/app/filter-sheet";

/** The two selections that are not a bracket. */
export { ALL_TEAMS, ON_FLOOR } from "@/components/board/running-board-scope";
import type { BoardDisplay } from "@/lib/visibility";

// The two fixed parts of the running board: the bar across the top that says
// where the competition is, and the panel down the side that says what is on
// the floor right now. Separated so the board itself is about what it chooses
// to show rather than how these are drawn.

export function BoardHeader({
  title,
  seriesLabel,
  seriesName,
  scored,
  focusNumber,
  waveTotal,
  waveState,
  waveClock,
  running,
}: {
  title: string;
  seriesLabel: string;
  seriesName: string;
  scored: number;
  focusNumber: number;
  waveTotal: number;
  waveState: string;
  waveClock: string;
  running: number;
}) {
  const t = useT();

  return (
    <header className="board-head">
      <div style={{ minWidth: 0 }}>
        <h1 className="display board-head-title">{title}</h1>
        <div className="board-head-series">
          {seriesName}
          {seriesLabel && seriesLabel !== seriesName ? (
            <>
              {" "}
              <i>{"///"}</i> {seriesLabel}
            </>
          ) : null}
        </div>
      </div>

      <div className="board-head-stats">
        <Stat label={t("Teams scored")} value={String(scored)} />
        <div className="board-head-clock" data-idle={running === 0 || undefined}>
          <div style={statLabel}>
            {t("Wave")} {focusNumber || "—"} / {waveTotal} · {waveState}
          </div>
          <div className="display num">{waveClock}</div>
        </div>
      </div>
    </header>
  );
}

export function FloorPanel({
  focusNumber,
  waveClock,
  floor,
  runningNumbers,
  display,
}: {
  focusNumber: number;
  waveClock: string;
  floor: {
    scored: (BoardTeam & { rank: number })[];
    pending: BoardTeam[];
    total: number;
  };
  runningNumbers: number[];
  display: BoardDisplay;
}) {
  const t = useT();

  return (
    <aside className="floor-panel">
      <div className="floor-panel-head">
        <div className="floor-panel-kicker">{t("On the floor now")}</div>

        <div className="floor-panel-wave">
          <div className="display">
            {t("Wave")} {focusNumber || "—"}
          </div>
          <div className="display num">{waveClock}</div>
        </div>

        <div className="floor-panel-count num">
          {floor.scored.length} {t("of")} {floor.total} {t("scored")}
        </div>

        {/* Which of the running waves is on show, and that it will turn. */}
        {runningNumbers.length > 1 ? (
          <div className="floor-pips" aria-live="polite">
            {runningNumbers.map((number) => (
              <span
                key={number}
                className="floor-pip"
                data-on={number === focusNumber || undefined}
              >
                {number}
              </span>
            ))}
            <span className="floor-pips-note">
              {t("turns every {n}s", { n: FLOOR_ROTATE_SECONDS })}
            </span>
          </div>
        ) : null}
      </div>

      <div className="floor-panel-rows">
        {floor.scored.map((team) => (
          <FloorRow key={team.id} team={team} position={team.rank} display={display} />
        ))}
        {floor.pending.map((team) => (
          <FloorRow key={team.id} team={team} position={null} display={display} />
        ))}
        {floor.total === 0 ? (
          <div className="floor-panel-empty">{t("No teams in this wave.")}</div>
        ) : null}
      </div>
    </aside>
  );
}

/** The nine brackets, plus "all" and "on the floor", plus auto-rotate. */
export function BracketChips({
  marks,
  floorView,
  runningNumbers,
  populated,
  rotate,
  onAll,
  onFloor,
  onToggleMark,
  onRotate,
}: {
  /** Brackets in the combined ranking — empty means the whole field. */
  marks: number[];
  floorView: boolean;
  runningNumbers: number[];
  populated: number[];
  rotate: boolean;
  onAll: () => void;
  onFloor: () => void;
  /** Mark or unmark a bracket in the combined ranking. */
  onToggleMark: (index: number) => void;
  onRotate: () => void;
}) {
  const t = useT();
  const allActive = !floorView && marks.length === 0;

  return (
    <div className="board-filters"><FilterSheet>
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          padding: "clamp(12px,2vw,16px) clamp(16px,3vw,36px) 0",
        }}
      >
        <button
          type="button"
          className="chip chip-dark"
          data-active={allActive || undefined}
          onClick={onAll}
        >
          {t("All teams")}
        </button>
        <button
          type="button"
          className="chip chip-dark"
          data-active={floorView || undefined}
          disabled={runningNumbers.length === 0}
          onClick={onFloor}
        >
          {runningNumbers.length === 0
            ? t("Nothing on the floor")
            : `${t("Waves")} ${runningNumbers.join(" + ")} ${t("on floor")}`}
        </button>

        {/* A marked bracket is IN the combined ranking; marking one shows the
            combined board at once, so the operator always sees the consequence
            of the click. */}
        {BRACKETS.map((bracket, index) => {
          const markedNow = marks.includes(index);
          return (
            <button
              key={`${bracket.category}-${bracket.division}`}
              type="button"
              className="chip chip-dark"
              data-active={markedNow || undefined}
              onClick={() => onToggleMark(index)}
              title={markedNow ? t("In the ranking") : t("Not in the ranking")}
              style={{ opacity: populated.includes(index) || markedNow ? 1 : 0.42 }}
            >
              {markedNow ? "● " : "○ "}
              {t(bracket.category)} {t(bracket.division)}
            </button>
          );
        })}

        <button
          type="button"
          className="chip chip-dark"
          data-active={rotate || undefined}
          onClick={onRotate}
          style={{ marginInlineStart: "auto" }}
        >
          {rotate ? t("Auto-rotate on") : t("Auto-rotate off")}
        </button>
      </div>
    </FilterSheet></div>
  );
}

/** How much of the bracket, and of the field, is in. */
export function BoardProgress({
  percent,
  scopeDone,
  scopeTotal,
  eventDone,
  eventTotal,
  sinceRefresh,
}: {
  percent: number;
  scopeDone: number;
  scopeTotal: number;
  eventDone: number;
  eventTotal: number;
  sinceRefresh: number;
}) {
  const t = useT();

  return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "clamp(12px,2vw,20px)",
          flexWrap: "wrap",
          margin: "clamp(12px,2vw,16px) clamp(16px,3vw,36px) 0",
          padding: "12px 16px",
          borderRadius: "var(--r-md)",
          border: "1px solid var(--board-border)",
          background: "var(--board-raised)",
        }}
      >
        <div style={statLabel}>{t("Bracket progress")}</div>
        <div
          style={{
            flex: 1,
            minWidth: 140,
            height: 8,
            borderRadius: "var(--r-pill)",
            background: "rgba(255,255,255,0.10)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${percent}%`,
              height: "100%",
              background: "var(--bft-cyan)",
              transition: "width 0.5s ease",
            }}
          />
        </div>
        <div
          className="display num"
          style={{ fontSize: "clamp(15px,1.7vw,22px)", color: "var(--board-text)", whiteSpace: "nowrap" }}
        >
          {scopeDone} / {scopeTotal}
        </div>
        <div
          style={{
            ...statLabel,
            borderInlineStart: "1px solid var(--board-border-strong)",
            paddingInlineStart: "clamp(12px,2vw,18px)",
          }}
        >
          {eventDone} / {eventTotal} {t("in so far")}
        </div>
        <div className="num" style={{ ...statLabel, marginInlineStart: "auto" }}>
          {t("Updated")} {sinceRefresh}s {t("ago")}
        </div>
      </div>

  );
}
