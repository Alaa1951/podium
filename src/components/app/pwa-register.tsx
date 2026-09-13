"use client";

import { useEffect } from "react";

/**
 * Registers the platform service worker once, on load.
 *
 * The worker caches nothing — it exists so Chromium offers the one-tap
 * install, and so a gym's wifi drop shows our offline page instead of the
 * browser's. iOS adds the app to the Home Screen without any of this.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // No worker = no install prompt; the app keeps working as a page.
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
