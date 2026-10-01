"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { CategorySummary } from "@/components/schedule/category-summary";
import { autoAssignWaves } from "@/lib/actions/teams";
import { arrangeWaveTimes, saveWave } from "@/lib/actions/waves";
import type { ScheduleConflict, SchedulePlan } from "@/lib/category-schedule";
import { conflictMessage, PROTECTED_HINT } from "@/lib/category-schedule-messages";
import { waveScheduleErrorMessage } from "@/lib/wave-schedule-messages";

// ─────────────────────────────────────────────────────────────────────────────
// BUILDING THE RUNNING ORDER — for whoever holds waves.edit on a floor
// account. Auto Assign by category needs the category schedule first; it
// shows what it will do before it is pressed, keeps every team running
// manually where it is, and on a conflict changes nothing and says why.
// Switched off in Settings (Category schedule › Auto Assign), the running
// order is built by hand: Add wave, Arrange time, each wave's own time and
// Move — nothing held up by the category blocks.
// ─────────────────────────────────────────────────────────────────────────────

export function ScheduleControls({
  seriesId,
  scheduled,
  autoAssign = true,
  plan,
  settingsHref,
  canBuild,
  canRebuild,
  waveCount,
  nextNumber,
  capacity,
  manualCount,
}: {
  seriesId: string;
  scheduled: boolean;
  /** Settings → Category schedule › Auto Assign. */
  autoAssign?: boolean;
  /** What Auto Assign would do now; null until the category schedule is complete. */
  plan: SchedulePlan | null;
  settingsHref: string;
  /** waves.edit on a floor account. */
  canBuild: boolean;
  /** Nothing has started: the running order may still be rebuilt. */
  canRebuild: boolean;
  waveCount: number;
  nextNumber: number;
  capacity: number;
  /** Teams running manually, which Auto Assign will keep in place. */
  manualCount: number;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [perWave, setPerWave] = useState(Math.min(9, capacity));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; conflicts?: ScheduleConflict[] } | null>(null);

  function report(result: { ok: boolean; error?: string; conflicts?: ScheduleConflict[]; teams?: number[] }, done: string) {
    if (result.ok) {
      setMessage({ tone: "ok", text: done });
      router.refresh();
      return;
    }
    const text =
      result.error === "SCHEDULE_CONFLICT"
        ? t("Auto Assign did not run: the day does not fit. Nothing was changed.")
        : result.error === "PROTECTED_CONFLICT"
          ? `${t(PROTECTED_HINT)}${result.teams?.length ? ` ${result.teams.map((n) => `#${n}`).join(", ")}` : ""}`
          : t(waveScheduleErrorMessage(result.error));
    setMessage({ tone: "error", text, conflicts: result.conflicts });
  }

  function runAutoAssign() {
    const question = manualCount
      ? t("Reassign every team that is not running manually? {count} team(s) running manually keep their wave and station.", { count: manualCount })
      : t("Reassign every team by the category schedule? Current waves and stations are replaced.");
    if (waveCount && !window.confirm(question)) return;
    setMessage(null);
    startTransition(async () => report(await autoAssignWaves({ seriesId, perWave }), t("Done. Every category runs in its own block; teams running manually were left in place.")));
  }

  function addWave() {
    setMessage(null);
    startTransition(async () => report(await saveWave({ seriesId, number: nextNumber }), ""));
  }

  function arrangeTime() {
    if (!window.confirm(t("Recalculate all wave start times? This replaces current times, including manual changes."))) return;
    setMessage(null);
    startTransition(async () => report(await arrangeWaveTimes({ seriesId }), ""));
  }

  return (
    <div className="schedule-controls">
      {canBuild ? (
        <div className="schedule-controls-row">
          <div>
            <label className="field-label" htmlFor="perWave">{t("Per wave")}</label>
            <input id="perWave" type="number" min={1} max={9} className="input pd-num" value={perWave} style={{ width: 90 }}
              onChange={(e) => setPerWave(Math.min(9, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
          <button type="button" className="btn btn-secondary" onClick={addWave} disabled={pending}>{t("Add wave")}</button>
          {autoAssign ? (
            <button type="button" className="btn btn-primary" onClick={runAutoAssign} disabled={pending || !canRebuild || !scheduled}>
              {pending ? <span className="spinner" /> : null}
              {t("Auto-assign waves")}
            </button>
          ) : null}
          {!scheduled ? (
            <button type="button" className="btn btn-secondary" onClick={arrangeTime} disabled={pending || !canRebuild || !waveCount}>{t("Arrange time")}</button>
          ) : null}
        </div>
      ) : null}

      {!autoAssign ? (
        <div className="notice" data-testid="auto-assign-off">
          <strong>{t("Auto Assign is off.")}</strong>{" "}
          {t("The running order is built by hand: change any wave's time, add waves and move teams freely — the category blocks hold nothing up. Nothing moves by itself.")}{" "}
          <Link href={settingsHref} className="linkish">{t("Settings → Category schedule")} →</Link>
        </div>
      ) : !scheduled ? (
        <div className="notice" data-testid="schedule-missing">
          <strong>{t("No category schedule yet.")}</strong>{" "}
          {t("Auto Assign places each category in its own block, so it needs every category's start time and break first. The current waves are kept as they are.")}{" "}
          <Link href={settingsHref} className="linkish">{t("Settings → Category schedule")} →</Link>
        </div>
      ) : (
        <>
          <p className="reg-sub" style={{ maxWidth: "70ch" }}>
            {t("Auto Assign places Men, Mixed and Women only in their own blocks, Rookie, Open, Pro within each; it never fills a block with another category's teams. Teams running manually stay exactly where they are. Below is what it would do now.")}
          </p>
          {plan ? <CategorySummary blocks={plan.blocks} conflicts={plan.conflicts} testId="auto-assign-preview" /> : null}
        </>
      )}

      {message?.text ? (
        <div className={message.tone === "ok" ? "notice" : "notice-error"} role={message.tone === "ok" ? "status" : "alert"} data-testid="schedule-message">
          {message.text}
          {message.conflicts?.length ? (
            <ul style={{ margin: "8px 0 0", paddingInlineStart: 18 }}>
              {message.conflicts.map((conflict, index) => <li key={index}>{conflictMessage(conflict, t)}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
