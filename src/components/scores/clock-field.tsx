"use client";

import { useT } from "@/components/i18n/locale-provider";

// ─────────────────────────────────────────────────────────────────────────────
// ONE MM:SS BOX.
//
// The judge's sheet and the franchise manual both write the finisher as a
// single "00:19", and a person copying one into two separate number fields has
// to stop and decide which half goes where. This is that one box.
//
// It is PRESENTATION ONLY. The two halves keep their own ids, their own maximum
// values and their own factors, and are sent to the server exactly as before —
// so nothing about the arithmetic depends on whether a series draws its
// finisher this way. See ZoneInputMode in lib/zones.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type ClockHalf = {
  id: string;
  value: number | null | undefined;
  maxValue: number | null;
};

export function ClockField({
  minutes,
  seconds,
  disabled,
  onChange,
  size = "md",
  label,
}: {
  minutes: ClockHalf;
  seconds: ClockHalf;
  disabled: boolean;
  /** Reports one half at a time, so the caller's draft stays keyed by input id. */
  onChange: (inputId: string, value: number | null) => void;
  size?: "sm" | "md";
  label?: string;
}) {
  const t = useT();

  return (
    <div
      className="clock-field"
      data-size={size}
      data-disabled={disabled || undefined}
      role="group"
      aria-label={label ?? t("Time remaining")}
    >
      <ClockHalfInput
        half={minutes}
        label={t("Minutes remaining")}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="clock-field-colon" aria-hidden>
        :
      </span>
      <ClockHalfInput
        half={seconds}
        label={t("Seconds remaining")}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

function ClockHalfInput({
  half,
  label,
  disabled,
  onChange,
}: {
  half: ClockHalf;
  label: string;
  disabled: boolean;
  onChange: (inputId: string, value: number | null) => void;
}) {
  const shown = half.value === null || half.value === undefined ? "" : String(half.value);

  return (
    <input
      aria-label={label}
      title={label}
      className="clock-field-half pd-num"
      type="number"
      inputMode="numeric"
      min={0}
      max={half.maxValue ?? undefined}
      placeholder="00"
      value={shown}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value.trim();
        onChange(half.id, raw === "" ? null : Number(raw));
      }}
    />
  );
}
