"use client";

import { useEffect, useMemo, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import type { BoardPayload } from "@/lib/board";
import { clockFromMs, rankAll } from "@/lib/scoring";
import {
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
// scores are polled, long brackets turn their own page, and it can rotate
// through the brackets on its own.

const PAGE_SECONDS = 14;
const ROTATE_SECONDS = 18;

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
  const [selection, setSelection] = useState<number>(ALL_TEAMS);
  /** Brackets marked for the rotation. Empty → the rotation uses every
   *  bracket that has scores, exactly as it always has. */
  const [marks, setMarks] = useState<number[]>([]);
  const [rotate, setRotate] = useState(false);
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
  // The same selection the figures use, ranked — so the board can never show
  // a row the progress bar has not counted.
  const rows = useMemo(
    () =>
      rankAll(
        teamsInScope({ teams: data.teams, selection, reached, runningNumbers }).filter(
          (team) => team.submitted
        )
      ),
    [data.teams, reached, runningNumbers, selection]
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const currentPage = page % pageCount;
  const visible = rows.slice(currentPage * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE + ROWS_PER_PAGE);

  // ── Page turn ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (pageCount <= 1) return;
    const id = setInterval(() => setPage((p) => p + 1), PAGE_SECONDS * 1000);
    return () => clearInterval(id);
  }, [pageCount]);

  // ── Bracket rotation ──────────────────────────────────────────────────────
  const populated = useMemo(() => populatedBrackets(data.teams), [data.teams]);

  // The rotation pool: the marked brackets, or every bracket with scores when
  // nothing is marked. Only brackets that actually have results can cycle —
  // an empty bracket on a wall board is a minute of nothing.
  const rotationPool = useMemo(
    () => (marks.length ? marks.filter((index) => populated.includes(index)) : populated),
    [marks, populated]
  );

  useEffect(() => {
    if (!rotate || rotationPool.length === 0) return;
    const id = setInterval(() => {
      setSelection((current) => {
        const at = rotationPool.indexOf(current);
        return at === -1 ? rotationPool[0] : rotationPool[(at + 1) % rotationPool.length];
      });
      setPage(0);
    }, ROTATE_SECONDS * 1000);
    return () => clearInterval(id);
  }, [rotate, rotationPool]);

  // ── Figures in the header ─────────────────────────────────────────────────
  const inScope = useMemo(
    () => teamsInScope({ teams: data.teams, selection, reached, runningNumbers }),
    [data.teams, reached, runningNumbers, selection]
  );

  const scopeDone = inScope.filter((x) => x.submitted).length;
  const scopePercent = inScope.length ? Math.round((scopeDone / inScope.length) * 100) : 0;

  const eventPool = data.teams.filter((x) => x.wave <= reached);
  const eventDone = eventPool.filter((x) => x.submitted).length;

  const title = scopeTitle({ t, selection, reached, runningNumbers });

  // Each wave carries its own length, so the fallback is that wave's rather
  // than one number standing in for the whole day.
  const focusRemaining = remainingFor(focusWave, elapsedMs);
  const waveClock =
    focusRemaining === null
      ? `${String(focusWave?.durationMinutes ?? data.waveMinutes).padStart(2, "0")}:00`
      : clockFromMs(focusRemaining);

  const waveState = waveStateLabel({
    t,
    teamCount: data.teams.length,
    reached,
    summary,
  });

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
        selection={selection}
        marked={marks}
        runningNumbers={runningNumbers}
        populated={populated}
        rotate={rotate}
        onSelect={(next) => {
          setSelection(next);
          setRotate(false);
          setPage(0);
        }}
        onToggleMark={(index) => {
          setPage(0);
          const marking = !marks.includes(index);
          setMarks((current) =>
            marking ? [...current, index] : current.filter((one) => one !== index)
          );
          // Marking a bracket jumps to it, so the operator sees what they just
          // added to the rotation. Unmarking never moves the board.
          if (marking) setSelection(index);
        }}
        onRotate={() => {
          const next = !rotate;
          setRotate(next);
          // Turning the rotation on with the current view outside the pool
          // snaps to the front of the pool, so the cycle is visible at once.
          if (next && rotationPool.length > 0 && !rotationPool.includes(selection)) {
            setSelection(rotationPool[0]);
            setPage(0);
          }
        }}
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
                showBracket={selection === ALL_TEAMS || selection === ON_FLOOR}
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
