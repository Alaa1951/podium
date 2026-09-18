"use client";

import { Capacitor } from "@capacitor/core";
import type { StatusBarInfo } from "@capacitor/status-bar";
import { useEffect } from "react";
import { iosTopFallback, nativeStatusInset } from "@/lib/mobile-safe-area";

/** Measure independently of App/Keyboard listeners: an older installed shell
 * missing one of those plugins must still keep every page below its clock. */
export function useNativeSafeArea() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const nativeIOS = Capacitor.getPlatform() === "ios";
    const root = document.documentElement;
    root.dataset.native = "true";
    root.dataset.nativePlatform = Capacitor.getPlatform();
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding-top:var(--safe-area-inset-top,env(safe-area-inset-top,0px))";
    document.body.appendChild(probe);
    let statusInset: number | undefined;
    let disposed = false;
    let refreshStatus: (() => Promise<void>) | undefined;
    const handles: Array<{ remove: () => Promise<void> }> = [];
    const update = () => {
      if (disposed) return;
      root.style.setProperty("--native-status-top", `${statusInset ?? 0}px`);
      root.style.setProperty("--ios-safe-top", `${iosTopFallback({
        nativeIOS,
        measuredTop: parseFloat(getComputedStyle(probe).paddingTop) || 0,
        nativeMeasurementKnown: statusInset !== undefined,
        // The keyboard changes viewport dimensions, not device orientation.
        portrait: typeof window.orientation === "number" ? Math.abs(window.orientation) % 180 === 0 : matchMedia("(orientation: portrait)").matches,
        tablet: /iPad/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
      })}px`);
    };
    const refresh = () => { update(); void refreshStatus?.(); };
    update();
    // Android SystemBars injects all four --safe-area-inset-* values itself.
    // On iOS, the official status bar measurement fills a zero env() value.
    if (nativeIOS && Capacitor.isPluginAvailable("StatusBar")) {
      void import("@capacitor/status-bar").then(async ({ StatusBar }) => {
        if (disposed) return;
        refreshStatus = async () => {
          try { statusInset = nativeStatusInset(await StatusBar.getInfo()); update(); }
          catch { /* Older store binary: keep env() or the legacy fallback. */ }
        };
        await refreshStatus();
        const changed = (info: StatusBarInfo) => { statusInset = nativeStatusInset(info); update(); };
        const register = async (registration: Promise<{ remove: () => Promise<void> }>) => {
          try {
            const handle = await registration;
            if (disposed) await handle.remove(); else handles.push(handle);
          } catch { /* Not implemented by older versions of the plugin. */ }
        };
        await Promise.all([
          register(StatusBar.addListener("statusBarVisibilityChanged", changed)),
          register(StatusBar.addListener("statusBarOverlayChanged", changed)),
        ]);
      }).catch(() => {});
    }
    window.addEventListener("resize", refresh);
    window.addEventListener("orientationchange", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      handles.forEach(handle => { void handle.remove(); });
      probe.remove();
      window.removeEventListener("resize", refresh);
      window.removeEventListener("orientationchange", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
}
