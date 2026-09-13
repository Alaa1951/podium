"use client";

import { useMemo, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import type { BoardPayload } from "@/lib/board";
import { clockFromMs, rankAll } from "@/lib/scoring";
import type { BoardDisplay } from "@/lib/visibility";
import { busiestBracket, gridColumns, Row, useRefreshCycle } from "@/components/board/leaderboard-parts";
import {
  BoardFilters,
  BoardFooter,
  BracketChips,
} from "@/components/board/leaderboard-controls";
import { SponsorStrip } from "@/components/board/sponsor-strip";

// The leaderboard. It runs unattended on a wall for a whole event day and is
// also read on a phone in the gym, so it refreshes itself, says when it will
// refresh next, and reflows to one column without losing the ranking.


export type LeaderboardProps = {
  initial: BoardPayload;
  display: BoardDisplay;
  studios: string[];
  /** "own" narrows the board to this studio; "all" shows the whole field. */
  scope: "all" | "own";
  ownStudioName: string | null;
  seriesLabel: string;
  backHref?: string;
};

export function Leaderboard({
  initial,
  display,
  studios,
  scope,
  ownStudioName,
  seriesLabel,
  backHref,
}: LeaderboardProps) {
  const t = useT();
  const [data, setData] = useState(initial);

  // Open on a bracket that actually has results. A fixed default lands on an
  // empty board whenever that bracket's waves have not run yet, which is most
  // of an event day.
  const opening = busiestBracket(initial.teams);
  const [category, setCategory] = useState(opening.category);
  const [division, setDivision] = useState(opening.division);
  const [studio, setStudio] = useState<string>(scope === "own" ? (ownStudioName ?? "__all") : "__all");
  const [query, setQuery] = useState("");

  // Adopt a fresher server render if one arrives.
  const [lastProp, setLastProp] = useState(initial);
  if (lastProp !== initial) {
    setLastProp(initial);
    setData(initial);
  }

  const refresh = useRefreshCycle(initial.seriesId, setData);

  // ── Rows ──────────────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    const pool = data.teams.filter(
      (team) =>
        team.submitted && team.category === category && team.division === division
    );
    return rankAll(pool);
  }, [data.teams, category, division]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => studio === "__all" || row.studioName === studio)
      .filter(
        (row) =>
          !q ||
          row.name.toLowerCase().includes(q) ||
          String(row.number).includes(q) ||
          row.competitors.some((a) => a.toLowerCase().includes(q))
      );
  }, [rows, studio, query]);

  const studioOptions = scope === "own" && ownStudioName ? [ownStudioName] : studios;

  return (
    <div className="board">
      {/* ── Head ─────────────────────────────────────────────────────────── */}
      <header
        style={{
          position: "relative",
          padding: "clamp(18px,3vw,28px) clamp(16px,4vw,40px) 0",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {backHref ? (
            <a href={backHref} className="btn btn-sm btn-on-dark">
              ‹ {t("Back")}
            </a>
          ) : (
            <span />
          )}

          <div
            className="push num"
            style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontWeight: 700,
              fontSize: "clamp(10px,1.2vw,12px)",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--board-text-muted)",
            }}
          >
            {t("Updating in")} {clockFromMs(refresh.remainingMs).replace(/^00:/, "0:")}
          </div>
        </div>
      </header>

      {/* ── Title ────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
          padding: "clamp(16px,2.6vw,26px) clamp(16px,4vw,40px) clamp(12px,2vw,18px)",
        }}
      >
        <h1
          className="display"
          style={{ fontSize: "clamp(26px,4.6vw,46px)", margin: 0, color: "var(--board-text)" }}
        >
          <span style={{ color: "var(--podium-blue-bright)" }}>{t(division)}</span>
          <span style={{ color: "var(--board-text-muted)" }}> · </span>
          <span style={{ color: "var(--podium-blue-bright)" }}>{t(category)}</span>{" "}
          {t("Leaderboard")}
        </h1>

        <div
          className="push"
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontWeight: 700,
            fontSize: "clamp(10px,1.2vw,13px)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--board-text-muted)",
          }}
        >
          {seriesLabel} <span style={{ color: "var(--podium-blue)" }}>{"///"}</span>{" "}
          {data.seriesName}
        </div>
      </div>

      <BracketChips
        category={category}
        division={division}
        hasScores={(c, d) =>
          data.teams.some((team) => team.submitted && team.category === c && team.division === d)
        }
        onPick={(c, d) => {
          setCategory(c);
          setDivision(d);
        }}
      />

      <BoardFilters
        studio={studio}
        studios={studioOptions}
        locked={scope === 'own'}
        query={query}
        onStudio={setStudio}
        onQuery={setQuery}
      />

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div style={{ padding: "0 clamp(16px,4vw,40px) clamp(28px,5vw,48px)" }}>
        <div
          className="board-head-row"
          style={{
            display: "grid",
            gridTemplateColumns: gridColumns(display),
            gap: 16,
            padding: "0 18px 10px",
            fontFamily: "var(--font-heading), sans-serif",
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--board-text-muted)",
          }}
        >
          <div>{t("Rank")}</div>
          <div>{t("Team")}</div>
          {display.showStudioColumn ? <div>{t("Studio")}</div> : null}
          <div style={{ textAlign: "end" }}>{t("Score")}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.map((row, index) => (
            <Row
              key={row.id}
              row={row}
              display={display}
              index={index}
            />
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="board-empty">
            {rows.length === 0
              ? t("No scores in this bracket yet")
              : t("No teams match your search.")}
          </div>
        ) : null}
      </div>

      <BoardFooter />

      <SponsorStrip enabled={data.sponsorsEnabled} logos={data.sponsors} />
    </div>
  );
}

/** The bracket with the most submitted scores, or the first if none have any. */
