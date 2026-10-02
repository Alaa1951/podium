"use client";

import { useT } from "@/components/i18n/locale-provider";
import { FloorRow, Stat, statLabel } from "@/components/board/running-board-parts";
import type { BoardTeam } from "@/lib/board";
import { FLOOR_ROTATE_SECONDS } from "@/lib/waves";
import { BRACKETS } from "@/lib/scoring";
import { LIVE_BRACKET_ORDER } from "@/components/board/running-board-scope";
import { FilterSheet } from "@/components/app/filter-sheet";

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
  lastWaveNumber,
  waveState,
  waveClock,
  running,
}: {
  title: string;
  seriesLabel: string;
  seriesName: string;
  scored: number;
  focusNumber: number;
  /** The last wave number of the day — the end of the number line. */
  lastWaveNumber: number;
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
            {t("Wave")} {focusNumber || "—"} {t("of")} {lastWaveNumber} · {waveState}
          </div>
          <div className="display num">{waveClock}</div>
        </div>
      </div>
    </header>
  );
}

export function FloorPanel({
  kicker,
  idle,
  upcoming = false,
  done = false,
  focusNumber,
  waveClock,
  floor,
  runningNumbers,
  display,
}: {
  /** "On the floor now", "Up next" or "All waves complete". */
  kicker: string;
  /** Nothing running: the clock is a countdown to a start, not a wave. */
  idle: boolean;
  /** Showing the NEXT wave: nothing in it can have scored, so its count is its teams. */
  upcoming?: boolean;
  /** No wave left to run: no wave, no rows — "No upcoming waves". */
  done?: boolean;
  focusNumber: number;
  waveClock: string;
  floor: {
    teams: BoardTeam[];
    scoredCount: number;
    total: number;
  };
  runningNumbers: number[];
  display: BoardDisplay;
}) {
  const t = useT();

  return (
    <aside className="floor-panel" data-idle={idle || undefined}>
      <div className="floor-panel-head">
        <div className="floor-panel-kicker">{kicker}</div>

        <div className="floor-panel-wave">
          <div className="display">
            {t("Wave")} {focusNumber || "—"}
          </div>
          <div className="display num">{waveClock}</div>
        </div>

        {done ? null : (
          <div className="floor-panel-count num" data-testid="floor-count">
            {upcoming
              ? t("{count} teams in this wave", { count: floor.total })
              : `${floor.scoredCount} ${t("of")} ${floor.total} ${t("scored")}`}
          </div>
        )}

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
        {floor.teams.map((team) => (
          <FloorRow key={team.id} team={team} display={display} />
        ))}
        {done ? (
          <div className="floor-panel-empty" data-testid="floor-none">{t("No upcoming waves.")}</div>
        ) : floor.total === 0 ? (
          <div className="floor-panel-empty" data-testid="floor-empty">{t("No teams in this wave.")}</div>
        ) : null}
      </div>
    </aside>
  );
}

/** Selected brackets form a playlist; the current bracket has its own highlight. */
export function BracketChips({
  marks,
  current,
  populated,
  rotate,
  onAll,
  onToggleMark,
  onRotate,
}: {
  /** Empty marks include every populated bracket in the playlist. */
  marks: number[];
  current: number | null;
  populated: number[];
  rotate: boolean;
  onAll: () => void;
  /** Include or exclude a bracket from the rotation. */
  onToggleMark: (index: number) => void;
  onRotate: () => void;
}) {
  const t = useT();
  const allActive = marks.length === 0;

  return (
    // NOT `board-filters`: that is the public results' two-column grid
    // (search + studio), and this has ONE child, which therefore landed in a
    // 240px-wide column — the chip row stacked into a narrow tower on every
    // desktop, and looked right on a phone, where the grid is one column.
    <div className="board-scope"><FilterSheet>
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          padding: "clamp(8px,1vw,10px) clamp(16px,3vw,36px) 0",
        }}
      >
        <button
          type="button"
          className="chip chip-dark"
          data-active={allActive || undefined}
          aria-pressed={allActive}
          onClick={onAll}
        >
          {t("Rotate all brackets")}
        </button>
        {LIVE_BRACKET_ORDER.map((index) => {
          const bracket = BRACKETS[index];
          const markedNow = marks.includes(index);
          const showing = current === index;
          return (
            <button
              key={`${bracket.category}-${bracket.division}`}
              type="button"
              className="chip chip-dark board-bracket-chip"
              data-active={showing || undefined}
              data-selected={markedNow || undefined}
              data-current={showing || undefined}
              data-bracket={index}
              aria-pressed={markedNow}
              aria-current={showing ? "true" : undefined}
              onClick={() => onToggleMark(index)}
              title={showing ? t("Showing now") : markedNow ? t("Included in rotation") : t("Choose for rotation")}
              style={{ opacity: populated.includes(index) || markedNow || showing ? 1 : 0.42 }}
            >
              <span aria-hidden="true">{markedNow ? "☑ " : "☐ "}</span>
              {t(bracket.category)} {t(bracket.division)}
            </button>
          );
        })}

        <button
          type="button"
          className="chip chip-dark"
          data-active={rotate || undefined}
          aria-pressed={rotate}
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
          margin: "clamp(8px,1vw,10px) clamp(16px,3vw,36px) 0",
          padding: "7px 14px",
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
