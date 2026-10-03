"use client";

import { useEffect, useRef, useState } from "react";

import { useBoardUpdates } from "@/components/board/use-board-updates";
import type { BoardPayload } from "@/lib/board";
import type { WaveState } from "@/lib/waves";

/** How often an unattended wall screen asks the server for a fresher board. */
const POLL_SECONDS = 10;

/**
 * Time left on a wave, from the duration the server sent and how long ago it
 * sent it. Every running wave is counted off the same elapsed figure, so two
 * waves on the floor stay in step with each other and with the operator.
 */
export function remainingFor(wave: WaveState | null, elapsedMs: number) {
  if (!wave || wave.remainingMs === null) return null;
  return Math.max(0, wave.remainingMs - elapsedMs);
}

/**
 * How long since the payload arrived, and the poll, on one cycle.
 *
 * The wave deadline arrives as a duration and is anchored against this
 * browser's clock, so a venue screen with the wrong system time still counts
 * the same twenty minutes as everyone else.
 */
export function useBoardClock(
  data: BoardPayload,
  seriesId: string,
  onData: (payload: BoardPayload) => void,
  /** Where fresher boards come from. Defaults to the signed-in board's API;
   *  the public wall passes its own (/api/live/...), which gates by phase. */
  pollHref?: string
) {
  const anchor = useRef<{ payload: BoardPayload; at: number } | null>(null);
  const lastPoll = useRef(0);
  const [clock, setClock] = useState({ elapsedMs: 0, sinceRefresh: 0 });
  const pull = useBoardUpdates(seriesId, onData, pollHref);

  useEffect(() => {
    anchor.current = { payload: data, at: Date.now() };
  }, [data]);

  useEffect(() => {
    lastPoll.current = Date.now();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const current = anchor.current;
      const now = Date.now();

      if (current) {
        const delta = now - current.at;
        setClock({ elapsedMs: delta, sinceRefresh: Math.floor(delta / 1000) });
      }

      if (now - lastPoll.current >= POLL_SECONDS * 1000) {
        lastPoll.current = now;
        if (!document.hidden) void pull();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [pull]);

  return clock;
}
