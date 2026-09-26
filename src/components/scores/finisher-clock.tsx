"use client";

import { useEffect, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { finisherRemainingMs, remainingClock } from "@/lib/floor";

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
  workMinutes,
  disabled,
  onCapture,
}: {
  /** When the team's wave clock runs out. */
  endsAt: string;
  /** One zone's work — the finisher is the last this many minutes of the wave. */
  workMinutes: number;
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

  // Null until the wave reaches the last zone: before that there is no
  // finisher running, and the wave clock still holds the other zones' time.
  const remainingMs = now === null ? null : finisherRemainingMs(new Date(endsAt).getTime() - now, workMinutes);
  const { minutes, seconds } = remainingClock(remainingMs ?? 0);
  const over = now !== null && remainingMs === 0;
  const early = now !== null && remainingMs === null;

  return (
    <button
      type="button"
      className="btn btn-sm btn-cyan"
      disabled={disabled || now === null || over || early}
      title={t("Record the wave's remaining time for this team")}
      onClick={() => {
        const captured = finisherRemainingMs(new Date(endsAt).getTime() - Date.now(), workMinutes);
        if (captured !== null) onCapture(remainingClock(captured));
      }}
    >
      {now === null
        ? `${t("Stop")} · --:--`
        : over
          ? t("Wave clock finished")
          : early
            ? t("Finisher not started")
            : `${t("Stop")} · ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`}
    </button>
  );
}
