"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-read the judge sheet every few seconds so a wave that has just started
 * appears on its own, and the zone clock stays current — and, when the clock
 * alone will change the sheet (a wave reaching the zone, a changeover
 * ending), right at that moment rather than up to a poll later.
 *
 * It keeps running while a card holds unsaved values: a judge taps +1 all
 * through the zone's work, and pausing then froze their clock for fifteen
 * minutes. The cards keep what is being typed across a re-read (keepTyping,
 * zones.ts). It only waits while the cursor is in a field.
 */
export function SheetRefresher({
  seconds = 10,
  changeInMs = null,
}: {
  seconds?: number;
  /** Milliseconds until the clock next changes this sheet; null or Infinity for none. */
  changeInMs?: number | null;
}) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const active = document.activeElement;
      if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return;
      router.refresh();
    };

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
  }, [router, seconds, changeInMs]);

  return null;
}
