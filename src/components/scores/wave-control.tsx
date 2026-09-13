"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { controlWave } from "@/lib/actions/waves";
import { clockFromMs } from "@/lib/scoring";
import { waveWindowLabel, type WaveState, type WaveSummary } from "@/lib/waves";

/**
 * The wave rack — every wave of the day, each with its own clock and its own
 * START.
 *
 * This used to be a single clock with "next wave" and "restart", which could
 * only ever describe one wave on the floor and made starting the day look like
 * repeating it. An operator now presses START on the wave they are about to
 * run, and may press it on a second one while the first is still going.
 *
 * The clock state lives on the wave row, so the board on the wall and the
 * operator's laptop count down the same twenty minutes.
 */
export function WaveControl({
  waves,
  summary,
  canControl,
}: {
  waves: WaveState[];
  summary: WaveSummary;
  canControl: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  if (waves.length === 0) {
    return (
      <div className="notice" style={{ marginBottom: 18 }}>
        <strong>{t("No waves yet.")}</strong>{" "}
        {t("Build the running order on the Teams screen — waves carry the clock.")}
      </div>
    );
  }

  function run(waveId: string, action: "start" | "finish" | "reset" | "extend") {
    setMessage("");
    startTransition(async () => {
      const result = await controlWave({ waveId, action, minutes: 1 });
      if (!result.ok) {
        setMessage(
          result.error === "NO_TEAMS"
            ? t("Assign teams to this wave before starting it.")
            : result.error === "ALREADY_RUNNING"
              ? t("That wave is already on the floor.")
              : t("Something went wrong. Try again.")
        );
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="wave-rack" aria-label={t("Wave control")}>
      <header className="wave-rack-head">
        <div>
          <div className="eyebrow">{t("Wave control")}</div>
          <div className="wave-rack-state">
            {summary.running > 0
              ? t("{n} on the floor now", { n: summary.running })
              : summary.complete >= summary.total
                ? t("All waves complete")
                : t("Nothing on the floor")}
            <span className="wave-rack-tally">
              {summary.complete}/{summary.total} {t("complete")}
            </span>
          </div>
        </div>
        {message ? (
          <div className="notice notice-warn wave-rack-msg">{message}</div>
        ) : null}
      </header>

      <div className="wave-rack-grid">
        {waves.map((wave) => (
          <WaveCard
            key={wave.id}
            wave={wave}
            canControl={canControl}
            pending={pending}
            onAction={run}
          />
        ))}
      </div>
    </section>
  );
}

function WaveCard({
  wave,
  canControl,
  pending,
  onAction,
}: {
  wave: WaveState;
  canControl: boolean;
  pending: boolean;
  onAction: (waveId: string, action: "start" | "finish" | "reset" | "extend") => void;
}) {
  const t = useT();
  const remaining = useCountdown(wave.remainingMs);
  const window = waveWindowLabel(wave.startTime, wave.durationMinutes);

  const clock =
    remaining === null
      ? `${String(wave.durationMinutes).padStart(2, "0")}:00`
      : clockFromMs(remaining);

  const over = wave.teamCount > wave.capacity;
  const statusLabel =
    wave.status === "running"
      ? t("On the floor")
      : wave.status === "complete"
        ? t("Complete")
        : t("Not started");

  return (
    <article className={`wave-card is-${wave.status}`}>
      <div className="wave-card-top">
        <div className="wave-card-no">
          <span className="wave-card-no-label">{t("Wave")}</span>
          <span className="wave-card-no-value pd-num">{wave.number}</span>
        </div>
        <span className={`badge ${wave.status === "running" ? "badge-live" : wave.status === "complete" ? "badge-ok" : "badge-neutral"}`}>
          {statusLabel}
        </span>
      </div>

      <div className="wave-card-clock pd-num" data-running={wave.status === "running"}>
        {clock}
      </div>

      <dl className="wave-card-meta">
        <div>
          <dt>{t("Scheduled")}</dt>
          <dd className="pd-num">
            {window.start}–{window.end}
          </dd>
        </div>
        <div>
          <dt>{t("Teams")}</dt>
          <dd className="pd-num" data-warn={over || undefined}>
            {wave.teamCount}/{wave.capacity}
          </dd>
        </div>
        <div>
          <dt>{t("Scored")}</dt>
          <dd className="pd-num">
            {wave.scoredCount}/{wave.teamCount}
          </dd>
        </div>
      </dl>

      {over ? (
        <p className="wave-card-warn">
          {t("Over capacity by {n}.", { n: wave.teamCount - wave.capacity })}
        </p>
      ) : null}

      {canControl ? (
        <div className="wave-card-actions">
          {wave.status === "pending" ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || wave.teamCount === 0}
              onClick={() => onAction(wave.id, "start")}
            >
              {t("Start wave")}
            </button>
          ) : null}

          {wave.status === "running" ? (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pending}
                onClick={() => onAction(wave.id, "extend")}
              >
                +1 {t("min")}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() => onAction(wave.id, "finish")}
              >
                {t("End wave")}
              </button>
            </>
          ) : null}

          {wave.status === "complete" ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pending}
              onClick={() => onAction(wave.id, "reset")}
            >
              {t("Reopen")}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * A duration from the server, anchored against this device's own clock.
 *
 * The server never sends an instant, so a laptop with the wrong system time
 * still counts the same twenty minutes as the board on the wall.
 */
function useCountdown(remainingMs: number | null) {
  const anchor = useRef<{ remaining: number | null; at: number } | null>(null);
  const [remaining, setRemaining] = useState(remainingMs);
  const [lastProp, setLastProp] = useState(remainingMs);

  if (lastProp !== remainingMs) {
    setLastProp(remainingMs);
    setRemaining(remainingMs);
  }

  useEffect(() => {
    anchor.current = { remaining: remainingMs, at: Date.now() };
  }, [remainingMs]);

  useEffect(() => {
    if (remainingMs === null) return;
    const id = setInterval(() => {
      const current = anchor.current;
      if (!current || current.remaining === null) return;
      setRemaining(Math.max(0, current.remaining - (Date.now() - current.at)));
    }, 1000);
    return () => clearInterval(id);
  }, [remainingMs]);

  return remaining;
}
