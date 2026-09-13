"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  onData: (payload: BoardPayload) => void
) {
  const anchor = useRef<{ payload: BoardPayload; at: number } | null>(null);
  const lastPoll = useRef(0);
  const handler = useRef(onData);
  const [clock, setClock] = useState({ elapsedMs: 0, sinceRefresh: 0 });

  useEffect(() => {
    handler.current = onData;
  }, [onData]);

  useEffect(() => {
    anchor.current = { payload: data, at: Date.now() };
  }, [data]);

  useEffect(() => {
    lastPoll.current = Date.now();
  }, []);

  const pull = useCallback(async () => {
    try {
      const res = await fetch(`/api/series/${seriesId}/board`, { cache: "no-store" });
      if (!res.ok) return;
      handler.current((await res.json()) as BoardPayload);
    } catch {
      // A dropped poll is not worth showing on a wall screen.
    }
  }, [seriesId]);

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
