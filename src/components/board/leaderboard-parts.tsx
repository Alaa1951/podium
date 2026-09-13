"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BoardPayload, BoardTeam } from "@/lib/board";
import { BRACKETS, fmt } from "@/lib/scoring";
import { teamLabel, type BoardDisplay } from "@/lib/visibility";

// The pieces the results board is assembled from: which bracket to open on,
// its grid, one row, and the poll that keeps it fresh.

/** How often a results board asks the server whether anything has changed. */
const POLL_SECONDS = 20;

export function busiestBracket(teams: BoardTeam[]) {
  let best = BRACKETS[0];
  let bestCount = -1;

  for (const bracket of BRACKETS) {
    const count = teams.filter(
      (team) =>
        team.submitted &&
        team.category === bracket.category &&
        team.division === bracket.division
    ).length;
    if (count > bestCount) {
      bestCount = count;
      best = bracket;
    }
  }

  return best;
}

export function gridColumns(display: BoardDisplay) {
  return display.showStudioColumn
    ? "auto minmax(0,1fr) minmax(0,0.5fr) auto"
    : "auto minmax(0,1fr) auto";
}

export function Row({
  row,
  display,
  index,
}: {
  row: BoardTeam & { rank: number };
  display: BoardDisplay;
  index: number;
}) {
  const label = teamLabel({ name: row.name, competitors: row.competitors }, display);

  return (
    <div
      className="board-row rise"
      data-rank={row.rank <= 3 ? row.rank : undefined}
      style={{
        gridTemplateColumns: gridColumns(display),
        // A short stagger so a refreshed board settles instead of snapping.
        animationDelay: `${Math.min(index, 12) * 18}ms`,
      }}
    >
      <div className="rank-disc num" data-rank={row.rank <= 3 ? row.rank : undefined}>
        {row.rank}
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontWeight: 700,
            fontSize: "clamp(15px,1.7vw,19px)",
            lineHeight: 1.25,
            color: "var(--board-text)",
            overflowWrap: "break-word",
          }}
        >
          {label.primary}
        </div>
        {label.secondary ? (
          <div
            style={{
              fontSize: "clamp(12px,1.2vw,13px)",
              color: "var(--board-text-muted)",
              marginTop: 2,
              overflowWrap: "break-word",
            }}
          >
            {label.secondary}
          </div>
        ) : null}
        {/* On a phone the studio column is gone, so it rides with the team. */}
        {display.showStudioColumn && row.studioName ? (
          <div className="board-row-studio-inline" style={{ display: "none" }}>
            {row.studioName}
          </div>
        ) : null}
      </div>

      {display.showStudioColumn ? (
        <div
          className="board-row-studio"
          style={{
            fontSize: "clamp(12px,1.2vw,14px)",
            color: "var(--board-text-muted)",
            minWidth: 0,
            overflowWrap: "break-word",
          }}
        >
          {row.studioName ?? "—"}
        </div>
      ) : null}

      <div
        className="display num"
        style={{
          fontSize: "clamp(20px,2.6vw,30px)",
          color: "var(--board-text)",
          whiteSpace: "nowrap",
          textAlign: "end",
        }}
      >
        {fmt(row.total, 2)}
      </div>
    </div>
  );
}

/**
 * Polls the board and reports how long until the next refresh, so the screen
 * can say "updating in 0:12" the way BFT's own board does.
 */
export function useRefreshCycle(seriesId: string, onData: (payload: BoardPayload) => void) {
  const [remainingMs, setRemainingMs] = useState(POLL_SECONDS * 1000);
  // Set on mount rather than during render: reading the clock is impure, and a
  // re-render would otherwise restart the cycle.
  const nextAt = useRef(0);
  const handler = useRef(onData);

  useEffect(() => {
    handler.current = onData;
  }, [onData]);

  useEffect(() => {
    nextAt.current = Date.now() + POLL_SECONDS * 1000;
  }, []);

  const pull = useCallback(async () => {
    try {
      const res = await fetch(`/api/series/${seriesId}/board`, { cache: "no-store" });
      if (!res.ok) return;
      handler.current((await res.json()) as BoardPayload);
    } catch {
      // A dropped poll is not worth showing on a wall screen — the board keeps
      // the numbers it has and tries again on the next cycle.
    }
  }, [seriesId]);

  useEffect(() => {
    const id = setInterval(() => {
      const left = nextAt.current - Date.now();
      if (left <= 0) {
        nextAt.current = Date.now() + POLL_SECONDS * 1000;
        setRemainingMs(POLL_SECONDS * 1000);
        if (!document.hidden) void pull();
      } else {
        setRemainingMs(left);
      }
    }, 250);
    return () => clearInterval(id);
  }, [pull]);

  return { remainingMs };
}
