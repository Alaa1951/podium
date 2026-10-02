"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { useT } from "@/components/i18n/locale-provider";

// THE VENUE WALL'S SHELL.
//
// /live/[series] hangs on a projector for a whole event day, so the shell
// does the three things an unattended screen needs and nothing else:
//
//   FULL SCREEN   a browser will not enter full screen by itself — it takes
//                 one click or key press, which is what the first gesture on
//                 the wall PC is for. The hint names that bargain and goes
//                 away the moment the screen is edge to edge (F11 or the
//                 kiosk shortcut make it unnecessary).
//   STAY AWAKE    a screen saver half an hour in would be the thing the room
//                 is looking at. The Screen Wake Lock API holds the display
//                 on where the browser supports it.
//   KEEP UP       the page is one server render of one phase; when the event
//                 moves — countdown out, last wave done, results published —
//                 the shell polls the phase and reloads, so the wall becomes
//                 the next thing without anybody touching it.

const STATUS_POLL_SECONDS = 20;

type WakeLockSentinel = {
  release: () => Promise<void>;
  addEventListener: (type: string, listener: () => void) => void;
};
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

/** The browser owns full screen; the shell only subscribes to it. */
function subscribeToFullscreen(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

export function WallShell({
  seriesId,
  phase,
  children,
}: {
  seriesId: string;
  /** The server-rendered phase; a different answer from the poll is a reload. */
  phase: string;
  children: ReactNode;
}) {
  const t = useT();
  const fullscreen = useSyncExternalStore(
    subscribeToFullscreen,
    () => Boolean(document.fullscreenElement),
    () => false,
  );

  // Full screen on the first gesture, and again after anything knocks the
  // browser out of it. Already full screen, there is nothing to ask for.
  useEffect(() => {
    const enter = () => {
      if (document.fullscreenElement) return;
      const root = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => void;
      };
      try {
        if (root.requestFullscreen) void root.requestFullscreen().catch(() => {});
        else root.webkitRequestFullscreen?.();
      } catch {
        // Not a user gesture, or the browser refuses — the hint stays and the
        // next click tries again.
      }
    };

    window.addEventListener("pointerdown", enter, { capture: true });
    window.addEventListener("keydown", enter, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", enter, { capture: true });
      window.removeEventListener("keydown", enter, { capture: true });
    };
  }, []);

  // The display stays on for as long as the page is on it.
  useEffect(() => {
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;

    const acquire = async () => {
      if (disposed || sentinel || document.visibilityState !== "visible") return;
      try {
        sentinel = await nav.wakeLock!.request("screen");
        sentinel.addEventListener("release", () => {
          sentinel = null;
        });
      } catch {
        // Denied or unsupported — the venue PC's own power settings decide.
      }
    };
    const onVisible = () => void acquire();

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, []);

  // The phase moved: the wall becomes the next screen (countdown out, last
  // wave done, results published) by re-reading the page it is already on.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/live/${seriesId}/status`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as { phase?: string };
        if (next.phase && next.phase !== phase) window.location.reload();
      } catch {
        // A dropped poll is not worth a reload; the next one answers.
      }
    }, STATUS_POLL_SECONDS * 1000);
    return () => clearInterval(id);
  }, [seriesId, phase]);

  return (
    <div className="wall-root">
      {children}
      {!fullscreen && (
        <div className="wall-fullscreen-hint" aria-hidden="true">
          {t("Click anywhere for full screen")}
        </div>
      )}
    </div>
  );
}
