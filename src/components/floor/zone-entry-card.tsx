"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useUnsavedChanges } from "@/components/app/mobile-runtime";
import { useT } from "@/components/i18n/locale-provider";
import { ClockField } from "@/components/scores/clock-field";
import { FinisherStop } from "@/components/scores/finisher-clock";
import { halfOf, show } from "@/components/scores/score-grid-row";
import { saveZoneScore } from "@/lib/actions/scores";
import { fmt } from "@/lib/scoring";
import { groupInputs, isComplete, isCounted, zonePoints, type EntryValues, type ZoneDef } from "@/lib/zones";

// ─────────────────────────────────────────────────────────────────────────────
// ONE TEAM, ONE ZONE — what a judge scores.
//
// The judge stands at one station of one zone; this card is the team in front
// of them, with only that zone's movements. Save keeps a draft; Submit locks
// the zone (only BFT MENA Full access can change it after). In the last zone
// the End button stops the wave clock for this team and submits at once.
// ─────────────────────────────────────────────────────────────────────────────

export type ZoneEntryTeam = {
  id: string;
  number: number;
  name: string;
  station: number | null;
  competitors: string[];
  waveNumber: number;
  values: EntryValues;
  locked: boolean;
  /** The wave clock's end — the finisher's clock in the last zone. */
  waveEndsAt: string | null;
  /** One zone's work in minutes — the finisher is the wave's last this-many. */
  finisherWorkMinutes: number;
};

const ERRORS: Record<string, string> = {
  SCORE_LOCKED: "This zone is submitted and locked. Ask BFT MENA for any correction.",
  WRONG_STATION: "This team is not on your station.",
  NO_STATION: "Your zone leader has not placed you on a station yet.",
  WAVE_NOT_HERE: "This wave has not reached your zone yet.",
  SERIES_NOT_LIVE: "The competition is not running.",
  INCOMPLETE: "Fill in every field before submitting.",
  INVALID_SCORE: "A value is out of range.",
  FORBIDDEN: "You are not allowed to score this.",
};

export function ZoneEntryCard({ team, zone }: { team: ZoneEntryTeam; zone: ZoneDef }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<EntryValues>(team.values);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // The server re-read this team: take what it now holds.
  const [seen, setSeen] = useState(team);
  if (seen !== team) {
    setSeen(team);
    setDraft(team.values);
    setError("");
  }

  const dirty = zone.inputs.some((input) => (draft[input.id] ?? null) !== (team.values[input.id] ?? null));
  useUnsavedChanges(dirty && !saved);
  const locked = team.locked;
  const complete = isComplete([zone], draft);

  function set(inputId: string, value: number | null) {
    setSaved(false);
    setDraft((current) => ({ ...current, [inputId]: value }));
  }

  function save(submit: boolean, values: EntryValues = draft) {
    if (submit && !window.confirm(t("Submit Zone {zone} for {team}? It locks once submitted.", { zone: zone.number, team: team.name }))) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await saveZoneScore({
          teamId: team.id,
          zoneId: zone.id,
          values: Object.fromEntries(zone.inputs.map((input) => [input.id, values[input.id] ?? null])),
          submit,
        });
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
          return;
        }
        setSaved(true);
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  return (
    <section className="card zone-entry" data-dirty={dirty || undefined} data-locked={locked || undefined}>
      <div className="zone-entry-head">
        <span className="station-number" title={t("Station")}>
          {team.station ?? "—"}
        </span>
        <span style={{ minWidth: 0 }}>
          <strong>
            {team.number} · {team.name}
          </strong>
          <span className="reg-sub" style={{ display: "block" }}>
            {team.competitors.join(" · ")} · {t("Wave")} {team.waveNumber}
          </span>
        </span>
        <span className={`badge ${locked ? "badge-ok" : "badge-neutral"}`} style={{ marginInlineStart: "auto" }}>
          {locked ? t("Submitted") : t("Open")}
        </span>
      </div>

      {groupInputs(zone).map((group) =>
        group.kind === "clock" ? (
          <div key={group.minutes.id} className="team-entry-field">
            <span className="team-entry-label">{t("Time remaining")}</span>
            <ClockField
              minutes={halfOf(group.minutes.id, group.minutes.maxValue, draft)}
              seconds={halfOf(group.seconds.id, group.seconds.maxValue, draft)}
              disabled={locked || pending}
              onChange={set}
              label={t("Time remaining")}
            />
            {team.waveEndsAt && !locked ? (
              <FinisherStop
                endsAt={team.waveEndsAt}
                workMinutes={team.finisherWorkMinutes}
                disabled={pending}
                onCapture={({ minutes, seconds }) => {
                  const next = { ...draft, [group.minutes.id]: minutes, [group.seconds.id]: seconds };
                  setDraft(next);
                  // End is the finish: record the time and submit the zone.
                  save(isComplete([zone], next), next);
                }}
              />
            ) : null}
          </div>
        ) : isCounted(group.input) ? (
          <div key={group.input.id} className="team-entry-field">
            <div className="team-entry-stepper-row">
              <button
                type="button"
                className="team-entry-stepper"
                disabled={locked || pending}
                aria-label={`${t(group.input.label)} +1`}
                onClick={() => set(group.input.id, Math.min((draft[group.input.id] ?? 0) + 1, group.input.maxValue ?? 9999))}
              >
                +1
              </button>
              <button
                type="button"
                className="team-entry-stepper-minus"
                disabled={locked || pending}
                aria-label={`${t(group.input.label)} −1`}
                onClick={() => set(group.input.id, Math.max(0, (draft[group.input.id] ?? 0) - 1))}
              >
                −1
              </button>
            </div>
            <div className="team-entry-count">
              <span className="pd-num team-entry-count-value">{draft[group.input.id] ?? 0}</span>
              <span className="team-entry-count-label">{t(group.input.label)}</span>
            </div>
          </div>
        ) : (
          <div key={group.input.id} className="team-entry-field">
            <span className="team-entry-label">{t(group.input.label)}</span>
            <input
              className="input pd-num team-entry-number"
              type="number"
              inputMode="numeric"
              min={0}
              max={group.input.maxValue ?? undefined}
              aria-label={t(group.input.label)}
              value={show(draft[group.input.id])}
              disabled={locked || pending}
              onChange={(e) => set(group.input.id, e.target.value.trim() === "" ? null : Number(e.target.value))}
            />
          </div>
        )
      )}

      <div className="zone-entry-foot">
        <span className="grid-card-pair">
          {t("Zone")} {zone.number} <strong className="pd-num">{fmt(zonePoints(zone, draft), 2)}</strong>
        </span>
        {!locked ? (
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" disabled={pending || !dirty} onClick={() => save(false)}>
              {pending ? <span className="spinner" /> : null}
              {saved && !dirty ? t("Saved") : t("Save")}
            </button>
            <button type="button" className="btn btn-primary" disabled={pending || !complete} onClick={() => save(true)}>
              {t("Submit zone")}
            </button>
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="notice-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}
    </section>
  );
}
