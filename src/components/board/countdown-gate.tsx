"use client";

import { useEffect, useRef, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { countdown } from "@/lib/scoring";

/**
 * What everyone — studio or competitor — sees before the event opens: the
 * countdown to the moment the board goes live, taken from the date set on the
 * event itself.
 *
 * The remaining time arrives as a DURATION and is anchored against this
 * browser's clock on arrival, so a venue screen with the wrong system time
 * still counts down exactly as long as everyone else's.
 */
export function CountdownGate({
  remainingMs,
  opensAtLabel,
  seriesName,
  previewHref,
}: {
  remainingMs: number;
  opensAtLabel: string;
  seriesName: string;
  /** BFT MENA only: rehearse the board that sits behind this screen. */
  previewHref?: string;
}) {
  const t = useT();
  const anchor = useRef<{ remaining: number; at: number } | null>(null);
  const [remaining, setRemaining] = useState(remainingMs);

  useEffect(() => {
    anchor.current = { remaining: remainingMs, at: Date.now() };
  }, [remainingMs]);

  useEffect(() => {
    const id = setInterval(() => {
      const current = anchor.current;
      if (!current) return;
      const next = current.remaining - (Date.now() - current.at);
      setRemaining(Math.max(0, next));
      // The board opens the moment the clock runs out — reload so the server
      // re-renders it rather than leaving a dead screen on the wall.
      if (next <= 0) window.location.reload();
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const parts = countdown(remaining);
  const cells: [string, string][] = [
    [parts.days, t("Days")],
    [parts.hours, t("Hours")],
    [parts.minutes, t("Minutes")],
    [parts.seconds, t("Seconds")],
  ];

  return (
    <div
      className="board"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(32px,7vw,72px) clamp(16px,4vw,32px)",
        textAlign: "center",
        gap: 6,
      }}
    >
      <div
        className="pulse"
        style={{
          marginTop: 22,
          fontFamily: "var(--font-heading), sans-serif",
          fontWeight: 700,
          fontSize: "clamp(10px,1.4vw,13px)",
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          color: "var(--board-text-muted)",
        }}
      >
        {t("Live board locked")}
      </div>

      <h1
        className="display"
        style={{
          fontSize: "clamp(52px,13vw,150px)",
          lineHeight: 0.9,
          margin: "6px 0 0",
          color: "var(--board-text)",
        }}
      >
        {t("Coming soon")}
      </h1>

      <div
        className="display"
        style={{
          fontSize: "clamp(16px,3.2vw,32px)",
          letterSpacing: "0.06em",
          color: "var(--podium-blue-bright)",
          marginTop: 8,
        }}
      >
        {opensAtLabel}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0,1fr))",
          gap: "clamp(8px,1.6vw,14px)",
          width: "min(760px, 100%)",
          marginTop: "clamp(26px,5vw,44px)",
        }}
      >
        {cells.map(([value, label], index) => (
          <div
            key={label}
            style={{
              borderRadius: "var(--r-lg)",
              border: "1px solid var(--board-border-strong)",
              background:
                index === 3 ? "rgba(35,35,255,0.16)" : "rgba(255,255,255,0.03)",
              padding: "clamp(12px,2.4vw,22px) 6px",
            }}
          >
            <div
              className="display num"
              key={value}
              style={{
                fontSize: "clamp(30px,8vw,76px)",
                lineHeight: 1,
                color: "var(--board-text)",
                animation: index === 3 ? "pd-tick 0.6s ease-out" : undefined,
              }}
            >
              {value}
            </div>
            <div
              style={{
                fontFamily: "var(--font-heading), sans-serif",
                fontWeight: 700,
                fontSize: "clamp(9px,1.2vw,11px)",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: "var(--board-text-muted)",
                marginTop: 6,
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>

      <p
        style={{
          fontSize: "clamp(13px,1.5vw,15px)",
          color: "var(--board-text-muted)",
          marginTop: "clamp(22px,4vw,32px)",
          maxWidth: "46ch",
        }}
      >
        {t(
          "The leaderboard unlocks automatically at the activation time. Nothing to do — this screen becomes the board."
        )}
      </p>

      <div
        style={{
          marginTop: 10,
          fontFamily: "var(--font-heading), sans-serif",
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.32)",
        }}
      >
        {seriesName}
      </div>

      {previewHref ? (
        <a href={previewHref} className="btn btn-sm btn-on-dark" style={{ marginTop: 18 }}>
          {t("Preview the board")}
        </a>
      ) : null}
    </div>
  );
}
