"use client";

import { useT } from "@/components/i18n/locale-provider";
import type { ZoneInputMode } from "@/lib/zones";

// ─────────────────────────────────────────────────────────────────────────────
// ONE MOVEMENT, BEING EDITED.
//
// Label, unit, what a unit is worth, its ceiling, and how its field is drawn.
// Lifted out of the zone editor because five near-identical fields written out
// five times is where a typo lives — every one of them now goes through the
// same `patch`.
// ─────────────────────────────────────────────────────────────────────────────

export type DraftInput = {
  id?: string;
  label: string;
  unit: string;
  multiplyBy: string;
  divideBy: string;
  maxValue: string;
  inputMode: ZoneInputMode;
};

export const BLANK_INPUT: DraftInput = {
  label: "",
  unit: "",
  multiplyBy: "1",
  divideBy: "1",
  maxValue: "",
  inputMode: "number",
};

export function MovementRow({
  movement,
  canRemove,
  onPatch,
  onRemove,
}: {
  movement: DraftInput;
  canRemove: boolean;
  onPatch: (patch: Partial<DraftInput>) => void;
  onRemove: () => void;
}) {
  const t = useT();

  const text = (
    key: "label" | "unit" | "multiplyBy" | "divideBy" | "maxValue",
    label: string,
    flex: string,
    extra?: { placeholder?: string; numeric?: boolean }
  ) => (
    <label style={{ flex }}>
      <span className="field-label">{label}</span>
      <input
        className={extra?.numeric ? "input pd-num" : "input"}
        value={movement[key]}
        onChange={(e) => onPatch({ [key]: e.target.value })}
        placeholder={extra?.placeholder}
        inputMode={extra?.numeric ? "numeric" : undefined}
      />
    </label>
  );

  return (
    <div className="form-row" style={{ alignItems: "flex-end" }}>
      {text("label", t("Label"), "2 1 180px", { placeholder: t("Deadlift reps") })}
      {text("unit", t("Unit"), "0 1 90px", { placeholder: "reps" })}
      {text("multiplyBy", "×", "0 1 84px", { numeric: true })}
      {text("divideBy", "÷", "0 1 84px", { numeric: true })}
      {text("maxValue", t("Max"), "0 1 96px", { placeholder: t("none"), numeric: true })}

      {/* How the field is DRAWN, not what it is worth. A minutes/seconds pair
          becomes the single MM:SS box the judge's sheet is written in. */}
      <label style={{ flex: "0 1 130px" }}>
        <span className="field-label">{t("Field")}</span>
        <select
          className="input"
          value={movement.inputMode}
          onChange={(e) => onPatch({ inputMode: e.target.value as ZoneInputMode })}
        >
          <option value="number">{t("Number")}</option>
          <option value="minutes">{t("Minutes (mm:ss)")}</option>
          <option value="seconds">{t("Seconds (mm:ss)")}</option>
        </select>
      </label>

      <button type="button" className="chip-sm" disabled={!canRemove} onClick={onRemove}>
        {t("Remove")}
      </button>
    </div>
  );
}
