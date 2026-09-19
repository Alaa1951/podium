"use client";

import { useEffect, useMemo, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import type { BoardPayload } from "@/lib/board";
import { clockFromMs, rankAll } from "@/lib/scoring";
import {
  markedBracketsLabel,
  markedBracketsTeams,
  populatedBrackets,
  scopeTitle,
  teamsInScope,
  waveStateLabel,
} from "@/components/board/running-board-scope";
import type { BoardDisplay } from "@/lib/visibility";
import { FLOOR_ROTATE_SECONDS, floorRotation } from "@/lib/waves";
import { columnsFor, ScoreRow, statLabel } from "@/components/board/running-board-parts";
import { remainingFor, useBoardClock } from "@/components/board/use-board-clock";
import {
  ALL_TEAMS,
  BoardHeader,
  BoardProgress,
  BracketChips,
  FloorPanel,
  ON_FLOOR,
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
// THE SCOPE IS ONE RANKING, NOT A PLAYLIST. Marking brackets combines them —
// every marked bracket's teams on one board, ranked against each other by
// score. Nothing marked is the whole field; the floor chip is this instant.

const PAGE_SECONDS = 14;

// This is read from across a gym, not scrolled on a desk. Ten rows fill a
// wall screen at a size somebody out of breath can actually read; the rest
// arrive on the next page, which turns itself.
const ROWS_PER_PAGE = 10;


export function RunningBoard({
  initial,
  display,
  seriesLabel,
}: {
  initial: BoardPayload;
  display: BoardDisplay;
  seriesLabel: string;
}) {
  const t = useT();
  const [data, setData] = useState(initial);
  /** The combined-ranking scope: the marked brackets. Empty → the whole field
   *  that has taken the floor so far. */
  const [marks, setMarks] = useState<number[]>([]);
  /** This instant on the floor, instead of a ranking. */
  const [floorView, setFloorView] = useState(false);
  /** ON is the resting state: the ranking's pages keep turning until someone
   *  stops them. Only this toggle does that — picking chips reshapes the
   *  ranking, it never freezes the board. */
  const [rotate, setRotate] = useState(true);
  const [page, setPage] = useState(0);

  const [lastProp, setLastProp] = useState(initial);
  if (lastProp !== initial) {
    setLastProp(initial);
    setData(initial);
  }

  const { elapsedMs, sinceRefresh } = useBoardClock(data, initial.seriesId, setData);

  // ── Which waves are on the floor ──────────────────────────────────────────
  // Several can be running at once. The board cannot show them all at once and
  // stay readable from across a gym, so it shows one and turns the page every
  // fifteen seconds — carrying that wave's number and whatever has been scored
  // in it so far.
  const summary = data.waveSummary;
  const runningNumbers = summary.runningNumbers;
  const [floorTick, setFloorTick] = useState(0);

  useEffect(() => {
    if (runningNumbers.length <= 1) return;
    const id = setInterval(() => setFloorTick((x) => x + 1), FLOOR_ROTATE_SECONDS * 1000);
    return () => clearInterval(id);
  }, [runningNumbers.length]);

  /** The wave the floor panel and the header clock are currently showing. */
  const focusNumber = floorRotation(runningNumbers, floorTick) ?? summary.reached;
  const focusWave = data.waves.find((wave) => wave.number === focusNumber) ?? null;

  // "The field so far" is every wave that has been started at all. A team in a
  // wave nobody has run yet is not missing a score — it has not competed.
  const reached = summary.reached;
  const columns = columnsFor(data.zoneDefs.length);

  // ── The rows on show ──────────────────────────────────────────────────────
  // One ranking of the current scope: the marked brackets combined, the field
  // so far, or this instant on the floor — always ranked by score, so the
  // board can never show a row the progress bar has not counted.
  const scopedTeams = () => {
    if (floorView) {
      return teamsInScope({ teams: data.teams, selection: ON_FLOOR, reached, runningNumbers });
    }
    if (marks.length > 0) {
      return markedBracketsTeams(data.teams, marks, reached);
    }
    return teamsInScope({ teams: data.teams, selection: ALL_TEAMS, reached, runningNumbers });
  };

  const rows = useMemo(
    () => rankAll(scopedTeams().filter((team) => team.submitted)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.teams, reached, runningNumbers, marks, floorView]
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const currentPage = page % pageCount;
  const visible = rows.slice(currentPage * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE + ROWS_PER_PAGE);

  // ── Page turn ─────────────────────────────────────────────────────────────
  // The ranking's pages keep turning until someone stops the ride.
  useEffect(() => {
    if (!rotate || pageCount <= 1) return;
    const id = setInterval(() => setPage((p) => p + 1), PAGE_SECONDS * 1000);
    return () => clearInterval(id);
  }, [rotate, pageCount]);

  // ── Figures in the header ─────────────────────────────────────────────────
  const inScope = scopedTeams();

  const scopeDone = inScope.filter((x) => x.submitted).length;
  const scopePercent = inScope.length ? Math.round((scopeDone / inScope.length) * 100) : 0;

  const eventPool = data.teams.filter((x) => x.wave <= reached);
  const eventDone = eventPool.filter((x) => x.submitted).length;

  // Brackets holding at least one submitted score — the rest render dimmed.
  const populated = useMemo(() => populatedBrackets(data.teams), [data.teams]);

  const title = floorView
    ? scopeTitle({ t, selection: ON_FLOOR, reached, runningNumbers })
    : marks.length > 0
      ? markedBracketsLabel(marks, t)
      : scopeTitle({ t, selection: ALL_TEAMS, reached, runningNumbers });

  // Each wave carries its own length, so the fallback is that wave's rather
  // than one number standing in for the whole day.
  const focusRemaining = remainingFor(focusWave, elapsedMs);
  const waveClock =
    focusRemaining === null
      ? `${String(focusWave?.durationMinutes ?? data.waveMinutes).padStart(2, "0")}:00`
      : clockFromMs(focusRemaining);

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
      reached,
      summary,
    }),
    zoneState,
  ]
    .filter(Boolean)
    .join(" · ");

  const floor = useMemo(() => {
    const onFloor = data.teams.filter((team) => team.wave === focusNumber);
    return {
      scored: rankAll(onFloor.filter((team) => team.submitted)),
      pending: onFloor.filter((team) => !team.submitted),
      total: onFloor.length,
    };
  }, [data.teams, focusNumber]);

  return (
    <div className="board" style={{ display: "flex", flexDirection: "column" }}>
      <BoardHeader
        title={title}
        seriesLabel={seriesLabel}
        seriesName={data.seriesName}
        scored={rows.length}
        focusNumber={focusNumber}
        waveTotal={summary.total}
        waveState={waveState}
        waveClock={waveClock}
        running={summary.running}
      />
      <BracketChips
        marks={marks}
        floorView={floorView}
        runningNumbers={runningNumbers}
        populated={populated}
        rotate={rotate}
        onAll={() => {
          setMarks([]);
          setFloorView(false);
          setPage(0);
        }}
        onFloor={() => {
          setFloorView(true);
          setPage(0);
        }}
        onToggleMark={(index) => {
          setFloorView(false);
          setPage(0);
          setMarks((current) =>
            current.includes(index)
              ? current.filter((one) => one !== index)
              : [...current, index]
          );
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

          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {visible.map((row, index) => (
              <ScoreRow
                key={row.id}
                row={row}
                display={display}
                index={index}
                showBracket={floorView || marks.length !== 1}
                columns={columns}
              />
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="board-empty">
              {t("No scores in this bracket yet")}
            </div>
          ) : null}

          {pageCount > 1 ? (
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
                  onClick={() => setPage((p) => (p - 1 + pageCount * 100) % pageCount)}
                >
                  {t("Prev")}
                </button>
                <button type="button" className="chip chip-dark" onClick={() => setPage((p) => p + 1)}>
                  {t("Next")}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <FloorPanel
          focusNumber={focusNumber}
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
