"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { deleteZone, saveZone, seedDefaultZones } from "@/lib/actions/zones";
import { factorLabel, type ZoneDef } from "@/lib/zones";
import {
  BLANK_INPUT,
  MovementRow,
  type DraftInput,
} from "@/components/admin/zone-movement-row";

// ─────────────────────────────────────────────────────────────────────────────
// THE SCORING DEFINITION, EDITED.
//
// A zone is a station. A movement is something measured at it. What a unit of
// that movement is worth is a multiplier and a divisor — which is how a person
// says it out loud ("reps times ten", "metres over a hundred") and also how the
// arithmetic stays exact.
//
// Editing this re-scores every team that ever recorded the movement, because
// points are derived and never stored. The screen says so, plainly, rather
// than letting somebody find out afterwards.
// ─────────────────────────────────────────────────────────────────────────────

type Draft = { zoneId?: string; number: string; name: string; inputs: DraftInput[] };

function toDraft(zone: ZoneDef): Draft {
  return {
    zoneId: zone.id,
    number: String(zone.number),
    name: zone.name,
    inputs: zone.inputs.map((input) => ({
      id: input.id,
      label: input.label,
      unit: input.unit,
      multiplyBy: String(input.multiplyBy),
      divideBy: String(input.divideBy),
      maxValue: input.maxValue === null ? "" : String(input.maxValue),
      inputMode: input.inputMode,
    })),
  };
}

export function ZoneEditor({
  seriesId,
  seriesName,
  zones,
  recordedValues,
}: {
  seriesId: string;
  seriesName: string;
  zones: ZoneDef[];
  /** How many measurements already exist under this definition. */
  recordedValues: number;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");

  function report(result: { ok: boolean; error?: string; message?: string }) {
    if (result.ok) {
      setMessage(result.message ?? "");
      setDraft(null);
      router.refresh();
      return;
    }
    setMessage(
      result.error === "ZONE_NUMBER_TAKEN"
        ? t("There is already a zone with that number.")
        : result.error === "ALREADY_DEFINED"
          ? t("This series already has zones.")
          : t("Check the form — every movement needs a label and whole factors.")
    );
  }

  function save() {
    if (!draft) return;
    setMessage("");
    startTransition(async () =>
      report(
        await saveZone({
          seriesId,
          zoneId: draft.zoneId,
          number: draft.number,
          name: draft.name,
          inputs: draft.inputs,
        })
      )
    );
  }

  function remove(zoneId: string) {
    setMessage("");
    startTransition(async () => report(await deleteZone({ zoneId })));
  }

  function startFromDefault() {
    setMessage("");
    startTransition(async () => report(await seedDefaultZones({ seriesId })));
  }

  const nextNumber = String(Math.max(0, ...zones.map((z) => z.number)) + 1);

  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          {seriesName}
        </h2>
        <span className="reg-sub">
          {zones.length} {t("zones")} ·{" "}
          {t("{n} recorded value(s) scored by this definition", { n: recordedValues })}
        </span>

        <div style={{ marginInlineStart: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {zones.length === 0 ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={startFromDefault}
            >
              {t("Start from the Series 1 table")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() =>
              setDraft({ number: nextNumber, name: "", inputs: [{ ...BLANK_INPUT }] })
            }
          >
            {t("Add zone")}
          </button>
        </div>
      </div>

      {message ? (
        <div className="notice" style={{ marginTop: 10 }}>
          {message}
        </div>
      ) : null}

      {recordedValues > 0 ? (
        <div className="notice notice-warn" style={{ marginTop: 10 }}>
          <strong>{t("Changing a factor re-scores the field.")}</strong>{" "}
          {t(
            "Points are worked out from these numbers every time they are read, never stored — so an edit here changes totals that have already been published."
          )}
        </div>
      ) : null}

      <div className="zone-list">
        {zones.map((zone) => (
          <article key={zone.id} className="zone-card">
            <div className="zone-card-head">
              <div>
                <div className="console-group-title">
                  {t("Zone")} {zone.number}
                </div>
                <div className="zone-card-name">{zone.name}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="chip-sm"
                  disabled={pending}
                  onClick={() => setDraft(toDraft(zone))}
                >
                  {t("Edit")}
                </button>
                <button
                  type="button"
                  className="chip-sm"
                  disabled={pending}
                  onClick={() => remove(zone.id)}
                >
                  {t("Remove")}
                </button>
              </div>
            </div>

            <table className="table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>{t("Movement")}</th>
                  <th style={{ width: 80 }}>{t("Unit")}</th>
                  <th style={{ width: 110 }}>{t("Worth")}</th>
                  <th style={{ width: 80, textAlign: "end" }}>{t("Max")}</th>
                </tr>
              </thead>
              <tbody>
                {zone.inputs.map((input) => (
                  <tr key={input.id}>
                    <td>{input.label}</td>
                    <td className="muted">{input.unit || "—"}</td>
                    <td className="pd-num">{factorLabel(input)}</td>
                    <td className="pd-num" style={{ textAlign: "end" }}>
                      {input.maxValue ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}

        {zones.length === 0 ? (
          <div className="notice">
            <strong>{t("No zones defined.")}</strong>{" "}
            {t("Scores cannot be entered for this series until there is at least one.")}
          </div>
        ) : null}
      </div>

      {/* ── The editor itself ────────────────────────────────────────────── */}
      {draft ? (
        <div className="form-block" style={{ marginTop: 14 }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>
            {draft.zoneId ? t("Edit zone") : t("New zone")}
          </h3>

          <div className="form-row">
            <label style={{ flex: "0 0 110px" }}>
              <span className="field-label">{t("Number")}</span>
              <input
                className="input pd-num"
                value={draft.number}
                onChange={(e) => setDraft({ ...draft, number: e.target.value })}
                inputMode="numeric"
              />
            </label>
            <label style={{ flex: "1 1 240px" }}>
              <span className="field-label">{t("Name")}</span>
              <input
                className="input"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t("Strength, Conditioning, Finisher…")}
              />
            </label>
          </div>

          <div className="console-group-title" style={{ marginTop: 14 }}>
            {t("Movements")}
          </div>
          <p className="reg-sub" style={{ margin: "2px 0 0" }}>
            {t(
              "A movement's points are its value multiplied and then divided. 10 reps × 10 ÷ 1 is 100; 3,221 m × 1 ÷ 100 is 32.21."
            )}
          </p>

          {draft.inputs.map((movement, index) => (
            <MovementRow
              key={index}
              movement={movement}
              canRemove={draft.inputs.length > 1}
              onPatch={(patch) => {
                const next = [...draft.inputs];
                next[index] = { ...movement, ...patch };
                setDraft({ ...draft, inputs: next });
              }}
              onRemove={() =>
                setDraft({ ...draft, inputs: draft.inputs.filter((_, i) => i !== index) })
              }
            />
          ))}

          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDraft({ ...draft, inputs: [...draft.inputs, { ...BLANK_INPUT }] })}
            >
              {t("Add movement")}
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>
              {t("Save zone")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDraft(null)}
              disabled={pending}
            >
              {t("Cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
