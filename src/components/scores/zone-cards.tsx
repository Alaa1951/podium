"use client";

import type { ReactNode } from "react";

import { BlueprintCard } from "@/components/app/page-shell";
import { useT } from "@/components/i18n/locale-provider";
import { ClockField } from "@/components/scores/clock-field";
import { numberInput, Row, Footer } from "@/components/scores/score-entry-parts";
import { fmt } from "@/lib/scoring";
import {
  factorLabel,
  groupInputs,
  zonePoints,
  type EntryValues,
  type ZoneDef,
  type ZoneInputDef,
} from "@/lib/zones";

// ─────────────────────────────────────────────────────────────────────────────
// ONE CARD PER ZONE.
//
// Drawn entirely from the series' definition: a card exists because a zone
// exists, a field exists because a movement exists, and a minutes/seconds pair
// is drawn as the single MM:SS box the judge's sheet is written in.
//
// This is the deliberate one-team editor: every save spends the studio's edit
// budget, so entry here is typed and confirmed by hand. The +1 taps live on
// the score sheet (score-grid-row), which saves on purpose.
// ─────────────────────────────────────────────────────────────────────────────

export function ZoneCards({
  zones,
  draft,
  disabled,
  onChange,
  clockExtra,
}: {
  zones: ZoneDef[];
  draft: EntryValues;
  disabled: boolean;
  onChange: (inputId: string, value: number | null) => void;
  /** Extra control under a clock field — the finisher stop lives here. */
  clockExtra?: (ids: { minutesId: string; secondsId: string }) => ReactNode;
}) {
  const t = useT();

  const numeric = (value: string) => (value.trim() === "" ? null : Number(value));

  const field = (inputId: string) => {
    const value = draft[inputId];
    return {
      value: value === null || value === undefined ? "" : String(value),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        onChange(inputId, numeric(e.target.value)),
      disabled,
    };
  };

  const half = (input: ZoneInputDef) => ({
    id: input.id,
    value: draft[input.id],
    maxValue: input.maxValue,
  });

  if (zones.length === 0) {
    return (
      <div className="notice" style={{ marginTop: 18 }}>
        <strong>{t("This series has no zones yet.")}</strong>{" "}
        {t("Define them in Configuration before scores can be entered.")}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
        gap: 14,
        marginTop: 18,
      }}
    >
      {zones.map((zone) => {
        const points = zonePoints(zone, draft);
        const groups = groupInputs(zone);
        const lone = groups.length === 1 && groups[0].kind === "single" ? groups[0].input : null;

        return (
          <BlueprintCard key={zone.id} style={{ padding: 16 }}>
            <div className="card-kicker">
              {t("Zone")} {zone.number} {"///"} {t(zone.name)}
            </div>

            {lone ? (
              // One movement fills the card rather than sitting on a row.
              <>
                <div className="card-title" style={{ marginBottom: 10 }}>
                  {t(lone.label)}
                  {lone.unit ? ` (${lone.unit})` : ""}
                </div>
                <input
                  className="input pd-num"
                  type="number"
                  min={0}
                  max={lone.maxValue ?? undefined}
                  {...field(lone.id)}
                  style={{ width: "100%", fontSize: 22, textAlign: "end" }}
                />
              </>
            ) : (
              groups.map((group) =>
                group.kind === "clock" ? (
                  <Row key={group.minutes.id} label={t("Time remaining")} unit="mm:ss">
                    <div style={{ display: "grid", gap: 8 }}>
                      <ClockField
                        minutes={half(group.minutes)}
                        seconds={half(group.seconds)}
                        disabled={disabled}
                        onChange={onChange}
                        size="sm"
                      />
                      {clockExtra?.({ minutesId: group.minutes.id, secondsId: group.seconds.id })}
                    </div>
                  </Row>
                ) : (
                  <Row key={group.input.id} label={t(group.input.label)} unit={group.input.unit}>
                    <input
                      className="input pd-num"
                      type="number"
                      min={0}
                      max={group.input.maxValue ?? undefined}
                      {...field(group.input.id)}
                      style={numberInput}
                    />
                  </Row>
                )
              )
            )}

            <Footer
              left={zone.inputs.map((input) => factorLabel(input)).join(" + ")}
              right={fmt(points, Number.isInteger(points) ? 0 : 2)}
            />
          </BlueprintCard>
        );
      })}
    </div>
  );
}
