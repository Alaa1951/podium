"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";

/**
 * Re-read the judge sheet every few seconds so a wave that has just started
 * appears on its own, and the zone clock stays current — and, when the clock
 * alone will change the sheet (a wave reaching the zone, a changeover
 * ending), right at that moment rather than up to a poll later.
 *
 * The sheet also rides the competition's live board events (`/events`): a wave
 * started, ended or reset pushes a refresh within a second, so the team on the
 * sheet is the team walking onto the floor — not one poll cycle behind them.
 * Score saves ride the same stream; a throttle keeps a room of judges' saves
 * from re-reading every sheet as fast as they arrive.
 *
 * It keeps running while a card holds unsaved values: a judge taps +1 all
 * through the zone's work, and pausing then froze their clock for fifteen
 * minutes. The cards keep what is being typed across a re-read (keepTyping,
 * zones.ts). It only waits while the cursor is in a field.
 */
const PUSH_MIN_GAP_MS = 2_500;

export function SheetRefresher({
  seconds = 10,
  changeInMs = null,
  seriesSlugs = "",
}: {
  seconds?: number;
  /** Milliseconds until the clock next changes this sheet; null or Infinity for none. */
  changeInMs?: number | null;
  /** Competitions this sheet works, comma-separated slugs — their board events push an extra refresh. A string, so a fresh server render never re-subscribes the stream. */
  seriesSlugs?: string;
}) {
  const router = useRouter();

  const refresh = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    const active = document.activeElement;
    if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return;
    router.refresh();
  }, [router]);

  useEffect(() => {
    const poll = setInterval(refresh, seconds * 1000);
    // A second after the change, so the server's clock is past it too.
    const due =
      changeInMs !== null && Number.isFinite(changeInMs) && changeInMs >= 0
        ? setTimeout(refresh, Math.min(changeInMs + 1000, 2_147_483_647))
        : null;
    return () => {
      clearInterval(poll);
      if (due) clearTimeout(due);
    };
  }, [refresh, seconds, changeInMs]);

  useEffect(() => {
    if (!seriesSlugs || typeof EventSource === "undefined") return;
    let last = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const pushed = () => {
      // At most one re-read every few seconds, and always the latest state:
      // a burst of events ends in one refresh, not one per event.
      const since = Date.now() - last;
      if (since >= PUSH_MIN_GAP_MS) {
        last = Date.now();
        refresh();
      } else if (!pending) {
        pending = setTimeout(() => {
          pending = null;
          last = Date.now();
          refresh();
        }, PUSH_MIN_GAP_MS - since);
      }
    };
    const sources = seriesSlugs.split(",").map((slug) => {
      const source = new EventSource(`/api/series/${encodeURIComponent(slug)}/events`);
      source.addEventListener("board", pushed);
      return source;
    });
    return () => {
      if (pending) clearTimeout(pending);
      for (const source of sources) source.close();
    };
  }, [refresh, seriesSlugs]);

  return null;
}
