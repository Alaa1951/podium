"use client";

import { Capacitor } from "@capacitor/core";
import { useEffect } from "react";
import { syncServiceWorker } from "@/lib/service-worker";

/**
 * Registers the platform service worker once, on load — in browsers only.
 *
 * The worker caches nothing — it exists so Chromium offers the one-tap
 * install, and so a gym's wifi drop shows our offline page instead of the
 * browser's. iOS adds the app to the Home Screen without any of this. Inside
 * the store shells it is removed instead (see syncServiceWorker).
 */
export function PwaRegister() {
  useEffect(() => {
    const sync = () => {
      syncServiceWorker(Capacitor.isNativePlatform(), navigator.serviceWorker).catch(() => {
        // No worker = no install prompt; the app keeps working as a page.
      });
    };
    if (document.readyState === "complete") sync();
    else window.addEventListener("load", sync, { once: true });
    return () => window.removeEventListener("load", sync);
  }, []);

  return null;
}
