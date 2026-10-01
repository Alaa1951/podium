"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useUnsavedChanges } from "@/components/app/mobile-runtime";
import { useT } from "@/components/i18n/locale-provider";
import { CategorySummary } from "@/components/schedule/category-summary";
import type { Category } from "@/generated/prisma/enums";
import { saveCategorySchedule, setAutoAssign } from "@/lib/actions/category-schedule";
import {
  DEFAULT_BLOCK_ORDER,
  MAX_BREAK_MINUTES,
  validateBlockConfig,
  type BlockConfig,
  type FixedWave,
  type PlanTeam,
  type ScheduleConflict,
  type ScheduleTiming,
  touchesProtected,
} from "@/lib/category-schedule";
import { planCategorySchedule } from "@/lib/category-schedule-plan";
import { conflictMessage, PROTECTED_HINT } from "@/lib/category-schedule-messages";

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS → CATEGORY SCHEDULE.
//
// For each category, in running order: when it starts, and the minimum break
// after its last wave finishes. The preview beneath is worked out as the
// person types, from the real field and the floor's own timing — the same
// planner Auto Assign runs — so a conflict is seen before it is saved.
//
// Nothing is invented: a competition that never had a schedule shows empty
// times, and Auto Assign stays off until every category has one. Saving moves
// no team; the next Auto Assign run lays the day out.
//
// The Auto Assign switch above it: off, the running order is built by hand —
// times saved here hold nothing up, and the waves are timed on the Waves
// screen.
// ─────────────────────────────────────────────────────────────────────────────

type Row = { category: Category; startTime: string; breakMinutes: string };

const ERRORS: Record<string, string> = {
  CATEGORY_SCHEDULE_INCOMPLETE: "Give every category a start time and a break.",
  INVALID_INPUT: "Check the times: a start is HH:mm, a break is 0 to 720 minutes.",
  FORBIDDEN: "You are not allowed to do that.",
  SERIES_FINISHED: "This competition is finished.",
  NOT_FOUND: "This competition is no longer available.",
};

export function CategoryScheduleForm({
  seriesId,
  dayLabel,
  initial,
  timing,
  teams,
  fixed,
  autoAssign,
  canEdit,
}: {
  seriesId: string;
  /** The competition's day, as people read it: the times are on this day, Qatar time. */
  dayLabel: string;
  initial: BlockConfig[];
  timing: ScheduleTiming;
  /** The field not running manually — what Auto Assign would place. */
  teams: PlanTeam[];
  /** Waves holding teams running manually — kept exactly by Auto Assign. */
  fixed: FixedWave[];
  /** Settings → Category schedule › Auto Assign. */
  autoAssign: boolean;
  /** waves.edit on a floor account (access.ts › canBuildSchedule). */
  canEdit: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const start: Row[] = initial.length
    ? initial.map((block) => ({ category: block.category, startTime: block.startTime, breakMinutes: String(block.breakMinutes) }))
    : DEFAULT_BLOCK_ORDER.map((category) => ({ category, startTime: "", breakMinutes: "" }));
  const [rows, setRows] = useState(start);
  const [baseline, setBaseline] = useState(JSON.stringify(start));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; conflicts?: ScheduleConflict[] } | null>(null);
  useUnsavedChanges(JSON.stringify(rows) !== baseline);

  // Shown switched at once; put back if the server refuses.
  const [autoOn, setAutoOn] = useState(autoAssign);

  function switchAutoAssign(enabled: boolean) {
    const question = enabled
      ? t("Turn Auto Assign on? It can then rebuild the running order by these blocks; teams moved by hand keep their slot. Nobody moves until somebody presses Auto-assign waves.")
      : t("Turn Auto Assign off? Waves, times and teams are then arranged by hand only, and the category blocks no longer hold up any change. Nobody moves now.");
    if (!window.confirm(question)) return;
    setMessage(null);
    setAutoOn(enabled);
    startTransition(async () => {
      try {
        const result = await setAutoAssign({ seriesId, enabled });
        if (!result.ok) {
          setAutoOn(!enabled);
          setMessage({ tone: "error", text: t(ERRORS[result.error] ?? "Something went wrong. Try again.") });
          return;
        }
        setMessage({ tone: "ok", text: enabled ? t("Auto Assign is on.") : t("Auto Assign is off. Change wave times and move teams on the Waves screen.") });
        router.refresh();
      } catch {
        setAutoOn(!enabled);
        setMessage({ tone: "error", text: t("Could not save. Check your connection and try again.") });
      }
    });
  }

  const blocks: BlockConfig[] = rows.map((row, index) => ({
    category: row.category,
    position: index + 1,
    startTime: row.startTime,
    breakMinutes: row.breakMinutes === "" ? Number.NaN : Number(row.breakMinutes),
  }));
  const valid = validateBlockConfig(blocks);
  // A few dozen teams: planning on every keystroke is cheap, and the preview never lags the form.
  const planned = valid.ok ? planCategorySchedule({ blocks: valid.blocks, timing, teams, fixed }) : null;
  // Off, a team running manually holds nothing up: its conflicts are not shown as if they would.
  const preview = planned && !autoOn ? { ...planned, conflicts: planned.conflicts.filter((conflict) => !touchesProtected(conflict)) } : planned;

  const set = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const move = (index: number, by: -1 | 1) =>
    setRows((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });

  function save() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await saveCategorySchedule({ seriesId, blocks: valid.ok ? valid.blocks : blocks });
        if (!result.ok) {
          setMessage(
            result.error === "PROTECTED_CONFLICT"
              ? { tone: "error", text: t(PROTECTED_HINT), conflicts: result.conflicts }
              : { tone: "error", text: t(ERRORS[result.error] ?? "Something went wrong. Try again.") }
          );
          return;
        }
        setBaseline(JSON.stringify(rows));
        setMessage({
          tone: "ok",
          text: !autoOn
            ? t("Saved. Auto Assign is off, so no wave moved: set the wave times on the Waves screen.")
            : result.conflicts.length
              ? t("Saved. Resolve the conflicts below before running Auto Assign.")
              : t("Saved. Auto Assign will lay the day out by these times; nobody has moved yet."),
        });
        router.refresh();
      } catch {
        setMessage({ tone: "error", text: t("Could not save. Check your connection and try again.") });
      }
    });
  }

  return (
    <section className="form-block category-schedule" data-testid="category-schedule">
      <h2 className="section-title">{t("Category schedule")}</h2>
      <p className="reg-sub" style={{ marginTop: 4, maxWidth: "70ch" }}>
        {t(
          "Each category runs in its own block, in this order. Its start is fixed; its break begins when its last wave finishes and is kept whole before the next category starts. Auto Assign places each team only in its own category's block, and never moves a start or shortens a break to make the day fit."
        )}
      </p>
      <p className="field-note">{t("Times are on {day}, Qatar time.", { day: dayLabel })}</p>

      <div className={autoOn ? "notice" : "notice-warn"} data-testid="auto-assign-switch" style={{ margin: "12px 0" }}>
        <label className="checkline">
          <input type="checkbox" checked={autoOn} disabled={!canEdit || pending} onChange={(event) => switchAutoAssign(event.target.checked)} />
          <strong>{t("Auto Assign")}</strong>
        </label>
        <p className="field-note" style={{ margin: "6px 0 0" }}>
          {autoOn
            ? t("On: Auto Assign builds the running order by these blocks, and changes that would break a block or move a team running manually are refused or need a confirmation.")
            : t("Off: the running order is built by hand. Change any wave's time, category times and team slots freely — nothing is refused because of the category blocks, and nothing moves by itself.")}
        </p>
      </div>

      <fieldset disabled={!canEdit || pending} className="category-schedule-rows">
        {rows.map((row, index) => (
          <div key={row.category} className="category-schedule-row" data-testid={`schedule-row-${row.category}`}>
            <span className="category-schedule-order pd-num">{index + 1}</span>
            <strong className="category-schedule-name">{t(row.category)}</strong>
            <label>
              <span className="field-label">{t("Starts at")}</span>
              <input className="input pd-num" type="time" value={row.startTime} aria-label={t("{category} starts at", { category: t(row.category) })}
                onChange={(event) => set(index, { startTime: event.target.value })} required />
            </label>
            <label>
              <span className="field-label">{t("Break after (minutes)")}</span>
              <input className="input pd-num" type="number" min={0} max={MAX_BREAK_MINUTES} step={5} value={row.breakMinutes}
                aria-label={t("Break after {category} (minutes)", { category: t(row.category) })}
                onChange={(event) => set(index, { breakMinutes: event.target.value })} required />
            </label>
            <span className="category-schedule-move">
              <button type="button" className="btn btn-ghost btn-sm" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("Move {category} earlier", { category: t(row.category) })}>↑</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={index === rows.length - 1} onClick={() => move(index, 1)} aria-label={t("Move {category} later", { category: t(row.category) })}>↓</button>
            </span>
          </div>
        ))}
      </fieldset>

      <h3 className="card-kicker" style={{ marginTop: 16 }}>{t("Preview")}</h3>
      {preview ? (
        <CategorySummary blocks={preview.blocks} conflicts={preview.conflicts} testId="schedule-preview" />
      ) : (
        <p className="notice" data-testid="schedule-incomplete">
          {t("Give every category a start time and a break to see the day. Until then Auto Assign stays off and the current waves are left as they are.")}
        </p>
      )}

      {message ? (
        <div className={message.tone === "ok" ? "notice" : "notice-error"} role={message.tone === "ok" ? "status" : "alert"} style={{ marginTop: 12 }}>
          {message.text}
          {message.conflicts?.length ? (
            <ul style={{ margin: "8px 0 0", paddingInlineStart: 18 }}>
              {message.conflicts.map((conflict, index) => <li key={index}>{conflictMessage(conflict, t)}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <button type="button" className="btn btn-primary" onClick={save} disabled={pending || !valid.ok}>
            {pending ? <span className="spinner" /> : null}
            {t("Save category schedule")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setRows(JSON.parse(baseline))} disabled={pending}>
            {t("Revert")}
          </button>
        </div>
      ) : (
        <p className="field-note">{t("Only whoever builds the running order (Waves: create waves and set times) can change this.")}</p>
      )}
    </section>
  );
}
