"use client";

import { useEffect, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";

/**
 * THE FINISHER CLOCK — per team, in the score card.
 *
 * The finisher (Zone 4) is a 5-minute window: the judge taps Start the moment
 * the pair steps onto the finisher floor, the clock counts down from the
 * series' own cap, and at 00:00 the time is over — zero finisher points for
 * that pair (they had their window).
 *
 * Capture freezes the remaining time into the minute/second inputs and saves
 * it automatically — that freeze IS the score: minutes ×10, seconds ÷10, per
 * the same table everything else uses.
 */
export function FinisherClock({
  capSeconds,
  running,
  onCapture,
}: {
  /** The series' finisher cap, in seconds. */
  capSeconds: number;
  /** Whether the finisher window is currently counting down. */
  running: boolean;
  /** Called with the remaining minutes and seconds at the moment of capture. */
  onCapture: (remaining: { minutes: number; seconds: number }) => void;
}) {
  const t = useT();
  const [remaining, setRemaining] = useState(capSeconds);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemaining((seconds) => {
        if (seconds <= 0) {
          clearInterval(id);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const over = remaining === 0;

  return (
    <div className="finisher-clock" data-over={over || undefined}>
      <div className="finisher-clock-display pd-num">
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </div>
      <div className="finisher-clock-actions">
        {!running ? (
          <button type="button" className="btn btn-sm btn-cyan" onClick={() => setRemaining(capSeconds)}>
            {t("Start finisher clock")}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => onCapture({ minutes, seconds })}
        >
          {t("Capture")}
        </button>
      </div>
    </div>
  );
}
