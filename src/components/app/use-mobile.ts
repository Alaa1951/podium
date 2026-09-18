"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";

export function useIsMobile(breakpoint = 900) {
  const query = `(max-width: ${breakpoint}px)`;
  const subscribe = useCallback((onChange: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => Capacitor.isNativePlatform() || window.matchMedia(query).matches, () => false);
}
