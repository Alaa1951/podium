"use client";

import { useMemo, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import type { BoardPayload } from "@/lib/board";
import { BRACKETS, clockFromMs } from "@/lib/scoring";
import {
  bracketViews,
  bracketStops,
  firstMarkedBracket,
  ROWS_PER_PAGE,
  stationOrder,
  waveStateLabel,
} from "@/components/board/running-board-scope";
import { BOARD_TURN_SECONDS } from "@/lib/board-rotation";
import { useBoardRotation } from "@/components/board/use-board-rotation";
import type { BoardDisplay } from "@/lib/visibility";
import { columnsFor, ScoreRow, statLabel } from "@/components/board/running-board-parts";
import { remainingFor, useBoardClock } from "@/components/board/use-board-clock";
import {
  BoardHeader,
  BoardProgress,
  BracketChips,
  FloorPanel,
} from "@/components/board/running-board-chrome";
import { SponsorStrip } from "@/components/board/sponsor-strip";

// THE BOARD WHILE THE EVENT IS RUNNING.
//
// A finished event needs a results table. An event in progress needs something
// else entirely: which wave is on the floor, how much of it is scored, how long
// is left on the clock, and how the field is moving. That is what this screen
// is — the content of the approved reference board, drawn in the current
// design system rather than its original one.
//
// It runs unattended on a wall all day, so everything it does is on a timer:
// scores are polled, long rankings turn their own pages, and the pages keep
// turning until someone stops them.
//
// One prize bracket at a time: finish its pages, then its category's levels,
// then the next category. Marks restrict the playlist, never merge rankings.


export function RunningBoard({
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
  /** Empty marks rotate through every bracket with a submitted zone. */
  const [marks, setMarks] = useState<number[]>([]);
  /** Pausing turns never pauses incoming scores. */
  const [rotate, setRotate] = useState(true);

  const [lastProp, setLastProp] = useState(initial);
  if (lastProp !== initial) {
    setLastProp(initial);
    setData(initial);
  }

  const { elapsedMs, sinceRefresh } = useBoardClock(data, initial.seriesId, setData, pollHref);

  // ── Which waves are on the floor ──────────────────────────────────────────
  // Several can be running at once. The board cannot show them all at once and
  // stay readable from across a gym, so it shows one and turns the page every
  // fifteen seconds — carrying that wave's number and whatever has been scored
  // in it so far.
  const summary = data.waveSummary;
  const runningNumbers = summary.runningNumbers;

  /**
   * The wave the floor panel and the header clock are currently showing: a
   * running wave (turning between them when there are several), else the one
   * the floor is waiting for, else — every wave run — the last of the day.
   */
  const idle = runningNumbers.length === 0;
  const nextWave = idle ? data.nextWave : null;
  const floorStops = (idle ? (nextWave ? [nextWave.number] : []) : runningNumbers)
    .map((number) => ({ id: number, pages: 1 }));
  const { cursor: floorCursor } = useBoardRotation(floorStops);
  const focusNumber = floorCursor.id ?? summary.lastNumber;
  const focusWave = data.waves.find((wave) => wave.number === focusNumber) ?? null;

  const reached = summary.reached;
  const columns = columnsFor(data.zoneDefs.length);

  const views = useMemo(() => bracketViews(data.teams, data.waves), [data.teams, data.waves]);
  const stops = useMemo(() => bracketStops(views, marks), [views, marks]);
  const { cursor, restart, turn } = useBoardRotation(stops, rotate, firstMarkedBracket(marks));
  const view = views.find((one) => one.index === cursor.id);
  const rows = view?.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const currentPage = cursor.page;
  const visible = rows.slice(currentPage * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE + ROWS_PER_PAGE);

  // ── Figures in the header ─────────────────────────────────────────────────
  const inScope = view?.teams ?? [];
  const scopeDone = rows.length;
  const scopePercent = inScope.length ? Math.round((scopeDone / inScope.length) * 100) : 0;
  const eventPool = views.flatMap((one) => one.teams);
  const eventDone = eventPool.filter((x) => x.scored).length;
  const populated = views.filter((one) => one.rows.length > 0).map((one) => one.index);
  const bracket = cursor.id === null ? null : BRACKETS[cursor.id];
  const title = bracket ? `${t(bracket.category)} ${t(bracket.division)}` : t("Leaderboard");

  // The clock always counts something real. On the floor: the time left on
  // that wave. Between waves: the time to the next wave's scheduled start
  // ("--:--" once it is due and waiting for START). Every wave run: 00:00.
  // It used to fall back to the wave's full length, which froze at 75:00
  // the moment the floor emptied.
  const focusRemaining = remainingFor(focusWave, elapsedMs);
  const nextStartsIn = nextWave?.startsInMs == null ? null : nextWave.startsInMs - elapsedMs;
  const waveClock = !idle
    ? clockFromMs(focusRemaining ?? 0)
    : nextWave
      ? nextStartsIn !== null && nextStartsIn > 0
        ? clockFromMs(nextStartsIn)
        : "--:--"
      : clockFromMs(0);

  // Where the wave in focus is in its rotation: "Zone 3", or changing zones.
  const focusFloor = focusWave?.status === "running" ? focusWave.floor : null;
  const zoneState = focusFloor?.zoneNumber
    ? focusFloor.phase === "break"
      ? `${t("Zone")} ${focusFloor.zoneNumber} → ${t("changing zones")}`
      : `${t("Zone")} ${focusFloor.zoneNumber}`
    : null;
  const waveState = [
    waveStateLabel({
      t,
      teamCount: data.teams.length,
      summary,
    }),
    zoneState,
  ]
    .filter(Boolean)
    .join(" · ");

  // The floor panel: exactly the teams ASSIGNED to the wave in focus — the
  // one running, or the next one (Up next) — and nobody else. An empty wave
  // is an empty panel, never the whole field.
  const upcoming = idle && Boolean(nextWave);
  const floor = useMemo(() => {
    const onFloor = idle && !nextWave ? [] : focusNumber ? data.teams.filter((team) => team.wave === focusNumber) : [];
    return {
      teams: stationOrder(onFloor),
      scoredCount: onFloor.filter((team) => team.scored).length,
      total: onFloor.length,
    };
  }, [data.teams, focusNumber, idle, nextWave]);

  return (
    <div className="board" data-testid="running-board" data-bracket={cursor.id ?? undefined} style={{ display: "flex", flexDirection: "column" }}>
      <BoardHeader
        title={title}
        seriesLabel={seriesLabel}
        seriesName={data.seriesName}
        scored={rows.length}
        focusNumber={focusNumber}
        lastWaveNumber={summary.lastNumber}
        waveState={waveState}
        waveClock={waveClock}
        running={summary.running}
      />
      <BracketChips
        marks={marks}
        current={cursor.id}
        populated={populated}
        rotate={rotate}
        onAll={() => {
          setMarks([]);
          restart(bracketStops(views, []), null);
        }}
        onToggleMark={(index) => {
          const next = marks.includes(index) ? marks.filter((one) => one !== index) : [...marks, index];
          setMarks(next);
          restart(bracketStops(views, next), firstMarkedBracket(next));
        }}
        onRotate={() => setRotate((v) => !v)}
      />

      <BoardProgress
        percent={scopePercent}
        scopeDone={scopeDone}
        scopeTotal={inScope.length}
        eventDone={eventDone}
        eventTotal={eventPool.length}
        sinceRefresh={sinceRefresh}
      />
      {/* ── Board and floor panel ────────────────────────────────────────── */}
      <div className="running-grid">
        <div style={{ minWidth: 0 }}>
          <div className="zone-grid zone-head" style={{ gridTemplateColumns: columns }}>
            <div>{t("Rank")}</div>
            <div>{t("Team")}</div>
            {data.zoneDefs.map((zone) => (
              <div
                key={zone.id}
                className="zone-col"
                style={{ textAlign: "end" }}
                title={zone.name}
              >
                Z{zone.number}
              </div>
            ))}
            <div style={{ textAlign: "end" }}>{t("Total")}</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {visible.map((row, index) => (
              <ScoreRow
                key={row.id}
                row={row}
                display={display}
                index={index}
                showBracket
                columns={columns}
              />
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="board-empty">
              {t("No scores in this bracket yet")}
            </div>
          ) : null}

          {pageCount > 1 || stops.length > 1 ? (
            <div className="board-pager">
              <div style={statLabel}>
                {t("Page")} {currentPage + 1} / {pageCount} ·{" "}
                {currentPage * ROWS_PER_PAGE + 1}–
                {Math.min(rows.length, currentPage * ROWS_PER_PAGE + ROWS_PER_PAGE)} {t("of")}{" "}
                {rows.length}
              </div>
              <div>
                <button
                  type="button"
                  className="chip chip-dark"
                  onClick={() => turn(-1)}
                >
                  {t("Prev")}
                </button>
                <button type="button" className="chip chip-dark" onClick={() => turn(1)}>
                  {t("Next")}
                </button>
              </div>
            </div>
          ) : null}
          <div className="board-turn-note" style={statLabel}>
            {rotate ? t("Pages, levels and categories turn every {n}s", { n: BOARD_TURN_SECONDS }) : t("Auto-rotate off")}
          </div>
        </div>

        <FloorPanel
          focusNumber={focusNumber}
          kicker={idle ? (nextWave ? t("Up next") : t("No upcoming waves")) : t("On the floor now")}
          idle={idle}
          upcoming={upcoming}
          done={idle && !nextWave}
          waveClock={waveClock}
          floor={floor}
          runningNumbers={runningNumbers}
          display={display}
        />
      </div>

      {/* ── Formula legend ───────────────────────────────────────────────── */}
      <footer className="board-legend">
        {data.zoneDefs.map((zone) => (
          <span key={zone.id}>
            Z{zone.number} {zone.name}
          </span>
        ))}
        <span>
          {reached > 0 ? `${t("Waves")} 1–${reached}` : t("No wave started yet")} ·{" "}
          {summary.complete}/{summary.total} {t("complete")}
        </span>
      </footer>

      <SponsorStrip enabled={data.sponsorsEnabled} logos={data.sponsors} />
    </div>
  );
}
