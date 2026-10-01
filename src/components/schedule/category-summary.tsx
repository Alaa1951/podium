"use client";

import { useT } from "@/components/i18n/locale-provider";
import { clockLabel, type BlockSummary, type ScheduleConflict } from "@/lib/category-schedule";
import { conflictMessage, durationLabel } from "@/lib/category-schedule-messages";

// ─────────────────────────────────────────────────────────────────────────────
// THE DAY BY CATEGORY — one row per block, in running order: its configured
// start, how much it holds, when it is estimated to finish, its break, and the
// earliest the next category may start. Then every conflict, in words.
// The same view in Settings (a live preview) and on the Waves screen.
// ─────────────────────────────────────────────────────────────────────────────

export function CategorySummary({ blocks, conflicts, testId }: { blocks: BlockSummary[]; conflicts: ScheduleConflict[]; testId?: string }) {
  const t = useT();
  const late = new Set(
    conflicts.flatMap((conflict) => (conflict.kind === "OVERRUN" || conflict.kind === "PAST_MIDNIGHT" || conflict.kind === "PROTECTED_BEFORE_BLOCK" ? [conflict.category] : []))
  );

  return (
    <div className="category-summary" data-testid={testId}>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>#</th>
              <th>{t("Category")}</th>
              <th>{t("Starts")}</th>
              <th>{t("Teams")}</th>
              <th>{t("Estimated finish")}</th>
              <th>{t("Break after")}</th>
              <th>{t("Next category from")}</th>
              <th>{t("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => (
              <tr key={block.category} data-testid={`block-${block.category}`}>
                <td className="pd-num" data-label="#">{block.position}</td>
                <td data-label={t("Category")}>
                  <strong>{t(block.category)}</strong>
                  {block.hosting.length ? (
                    <div className="reg-sub">{t("Also runs other categories' teams here: {teams}", { teams: block.hosting.map((n) => `#${n}`).join(", ") })}</div>
                  ) : null}
                  {block.elsewhere.length ? (
                    <div className="reg-sub">{t("Runs outside this block: {teams}", { teams: block.elsewhere.map((n) => `#${n}`).join(", ") })}</div>
                  ) : null}
                </td>
                <td className="pd-num" data-label={t("Starts")}>{clockLabel(block.startMinutes)}</td>
                <td className="pd-num" data-label={t("Teams")}>
                  <span style={{ whiteSpace: "nowrap" }}>{block.teams === 1 ? t("1 team") : t("{count} teams", { count: block.teams })}</span>
                  <div className="reg-sub" style={{ whiteSpace: "nowrap" }}>{block.waves === 1 ? t("1 wave") : t("{count} waves", { count: block.waves })}</div>
                </td>
                <td className="pd-num" data-label={t("Estimated finish")}>{block.finishMinutes === null ? "—" : clockLabel(block.finishMinutes)}</td>
                <td className="pd-num" data-label={t("Break after")}>{durationLabel(block.breakMinutes, t)}</td>
                <td className="pd-num" data-label={t("Next category from")}>
                  {block.nextCategory ? `${clockLabel(block.earliestNextMinutes)} · ${t(block.nextCategory)}` : clockLabel(block.earliestNextMinutes)}
                </td>
                <td data-label={t("Status")}>
                  {late.has(block.category) ? <span className="badge badge-danger">{t("Conflict")}</span> : <span className="badge badge-ok">{t("Fits")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {conflicts.length ? (
        <ul className="schedule-conflicts" role="alert" data-testid="schedule-conflicts">
          {conflicts.map((conflict, index) => (
            <li key={index} className="notice-error">{conflictMessage(conflict, t)}</li>
          ))}
        </ul>
      ) : (
        <p className="field-note" data-testid="schedule-fits">{t("Every category fits, with its full break before the next one.")}</p>
      )}
    </div>
  );
}
