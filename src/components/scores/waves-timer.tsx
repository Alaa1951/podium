"use client";

import { useEffect, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";

/**
 * THE WAVE TIMER — pinned in the score entry screen.
 *
 * Starts automatically the moment the wave is started, counts down from the
 * wave's own duration (15:00 or whatever the series set), and stays VISIBLE
 * and pinned for the whole scoring session. At 00:00 the wave clock sweep
 * finishes the wave automatically — the timer keeps showing 00:00 (it does
 * not disappear), so the operator always knows where the floor stands.
 *
 * If more than one wave is running (different locations), the arrows cycle
 * between their clocks — same pattern as the wall board's floor panel.
 */
export function WavesTimer({
  runningWaves,
  remainingByWave,
}: {
  /** The running wave numbers, in order. */
  runningWaves: number[];
  /** remainingMs per wave number, anchored by the live payload. */
  remainingByWave: Record<number, number | null>;
}) {
  const t = useT();
  const [index, setIndex] = useState(0);

  const count = runningWaves.length;
  useEffect(() => {
    if (count <= 1) return;
    const id = setInterval(() => setIndex((x) => (x + 1) % count), 5000);
    return () => clearInterval(id);
  }, [count]);

  if (count === 0) return null;

  const waveNumber = runningWaves[Math.min(index, count - 1)];
  const remainingMs = remainingByWave[waveNumber] ?? null;
  const seconds = remainingMs === null ? null : Math.max(0, Math.ceil(remainingMs / 1000));
  const label =
    seconds === null
      ? "--:--"
      : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="waves-timer" role="timer" aria-label={t("Wave time remaining")}>
      {count > 1 ? (
        <button
          type="button"
          className="waves-timer-arrow"
          aria-label={t("Previous wave")}
          onClick={() => setIndex((x) => (x - 1 + count) % count)}
        >
          ‹
        </button>
      ) : null}

      <span className="waves-timer-value pd-num">{label}</span>

      {count > 1 ? (
        <button
          type="button"
          className="waves-timer-arrow"
          aria-label={t("Next wave")}
          onClick={() => setIndex((x) => (x + 1) % count)}
        >
          ›
        </button>
      ) : null}

      <span className="waves-timer-label">{t("Wave")} {waveNumber}</span>
    </div>
  );
}
