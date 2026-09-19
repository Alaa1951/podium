"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-read the judge sheet every few seconds so the next wave appears on its
 * own — but never while somebody is typing or has unsaved values on screen,
 * so a refresh can never throw away a half-entered score.
 */
export function SheetRefresher({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (document.querySelector('[data-dirty="true"]')) return;
      const active = document.activeElement;
      if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return;
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
