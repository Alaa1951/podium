"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * A page brought back from the browser's back-forward cache (an iPhone
 * swipe-back, above all) is shown exactly as it was — including "No entry
 * found" from before a seat was linked. Re-read the server when that happens.
 * Nothing fires on an ordinary load.
 */
export function BfcacheRefresh() {
  const router = useRouter();
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [router]);
  return null;
}
