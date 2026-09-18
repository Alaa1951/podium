"use client";

import { useEffect, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";

/**
 * THE FINISHER STOP — one press per finished team.
 *
 * The wave clock IS the finisher's clock: what Zone 4 records is the time the
 * wave had left at the moment the team finished. This button shows that
 * remaining time live, and pressing it hands the minutes and seconds to the
 * score — which then saves on its own, because a captured finisher time that
 * still needs a separate SAVE is a finisher time waiting to be lost.
 */
export function FinisherStop({
  endsAt,
  disabled,
  onCapture,
}: {
  /** When the team's wave clock runs out. */
  endsAt: string;
  disabled: boolean;
  /** Called with the remaining minutes and seconds at the moment of the stop. */
  onCapture: (remaining: { minutes: number; seconds: number }) => void;
}) {
  const t = useT();
  // The clock reads the wall through state, so every render is pure: the
  // tick only moves 'now', and the rest is arithmetic on it.
  // The server and first browser render share a placeholder. Reading the wall
  // during initial render can change the second while HTML is in transit.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if(active) setNow(Date.now()); });
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const remainingMs = now === null ? 0 : Math.max(0, new Date(endsAt).getTime() - now);
  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000);
  const over = now !== null && remainingMs === 0;

  return (
    <button
      type="button"
      className="btn btn-sm btn-cyan"
      disabled={disabled || now === null || over}
      title={t("Record the wave's remaining time for this team")}
      onClick={() => {
        const captured = Math.max(0, new Date(endsAt).getTime() - Date.now());
        onCapture({ minutes: Math.floor(captured / 60_000), seconds: Math.floor((captured % 60_000) / 1000) });
      }}
    >
      {now === null ? `${t("Stop")} · --:--` : over ? t("Wave clock finished") : `${t("Stop")} · ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`}
    </button>
  );
}
