"use client";

import { useCallback, useEffect, useRef } from "react";

import type { BoardPayload } from "@/lib/board";
import { createBoardRefresh } from "@/lib/board-refresh";

/** Immediate notifications supplement the clock's existing fallback polls. */
export function useBoardUpdates(seriesId: string, onData: (data: BoardPayload) => void, pollHref?: string) {
  const handler = useRef(onData);
  const refresher = useRef<ReturnType<typeof createBoardRefresh<BoardPayload>> | null>(null);
  const href = pollHref ?? `/api/series/${encodeURIComponent(seriesId)}/board`;

  useEffect(() => { handler.current = onData; }, [onData]);

  useEffect(() => {
    const pulls = createBoardRefresh(async () => {
      const response = await fetch(href, { cache: "no-store" });
      return response.ok ? await response.json() as BoardPayload : null;
    }, (data) => handler.current(data));
    refresher.current = pulls;
    let source: EventSource | null = null;
    const connect = () => {
      if (document.hidden || source || typeof EventSource === "undefined") return;
      source = new EventSource(href.replace(/\/board$/, "/events"));
      source.addEventListener("board", () => { void pulls.refresh(); });
      // EventSource reconnects automatically after a dropped stream. Its first
      // event requests a payload, including changes made while disconnected.
    };
    const visible = () => {
      if (document.hidden) { source?.close(); source = null; }
      else { connect(); void pulls.refresh(); }
    };
    const online = () => { connect(); void pulls.refresh(); };
    connect();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", online);
    return () => {
      pulls.stop();
      if (refresher.current === pulls) refresher.current = null;
      source?.close();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", online);
    };
  }, [href]);

  return useCallback(() => refresher.current?.refresh(), []);
}
