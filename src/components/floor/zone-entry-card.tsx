"use client";

import { useRouter } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, useState, useTransition } from "react";

import { useUnsavedChanges } from "@/components/app/mobile-runtime";
import { useT } from "@/components/i18n/locale-provider";
import { ClockField } from "@/components/scores/clock-field";
import { FinisherStop } from "@/components/scores/finisher-clock";
import { halfOf, show } from "@/components/scores/score-grid-row";
import { useScoreAutosave } from "@/components/scores/use-score-autosave";
import { saveZoneScore } from "@/lib/actions/scores";
import { fmt } from "@/lib/scoring";
import type { ScorePatch } from "@/lib/score-autosave";
import { groupInputs, isComplete, isCounted, keepTyping, zonePoints, type EntryValues, type ZoneDef } from "@/lib/zones";

// ─────────────────────────────────────────────────────────────────────────────
// ONE TEAM, ONE ZONE — what a judge scores.
//
// The judge stands at one station of one zone; this card is the team in front
// of them, with only that zone's movements. Every edit saves a draft; Submit locks
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
  WAVE_MOVED_ON: "The next wave has reached your zone, so this team is closed for you. Your zone leader can still submit it.",
  SERIES_NOT_LIVE: "The competition is not running.",
  SCORE_ENTRY_CLOSED: "Score entry has closed for this competition.",
  INCOMPLETE: "Fill in every field before submitting.",
  INVALID_SCORE: "A value is out of range.",
  FORBIDDEN: "You are not allowed to score this.",
};

export function ZoneEntryCard({ team, zone }: { team: ZoneEntryTeam; zone: ZoneDef }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<EntryValues>(team.values);
  const draftRef = useRef<EntryValues>(team.values);
  useLayoutEffect(() => { draftRef.current = draft; }, [draft]);
  const [error, setError] = useState("");
  const saveDraft = useCallback((values: ScorePatch) => saveZoneScore({
    teamId: team.id, zoneId: zone.id, values, submit: false, autosave: true,
  }), [team.id, zone.id]);
  const autosave = useScoreAutosave(saveDraft);

  // The server re-read this team: take what it now holds.
  // The server re-read this team — the sheet's poll, another card's save, the
  // leader's wave panel. Values somebody is still typing are KEPT: only a card
  // with nothing unsaved takes the server's values, and a zone that has just
  // been submitted always does (it is locked now). Taking them regardless
  // wiped a half-entered score every few seconds.
  const [seen, setSeen] = useState(team);
  if (seen !== team) {
    setSeen(team);
    setDraft(seen.id !== team.id ? team.values : keepTyping([zone], draft, seen.values, team.values, team.locked ? [zone.id] : []));
    setError("");
  }

  useUnsavedChanges(autosave.dirty || pending);
  const locked = team.locked;
  const complete = isComplete([zone], draft);

  function set(inputId: string, value: number | null | ((current: number) => number)) {
    const nextValue = typeof value === "function" ? value(draftRef.current[inputId] ?? 0) : value;
    const next = { ...draftRef.current, [inputId]: nextValue };
    draftRef.current = next;
    setDraft(next);
    setError("");
    autosave.enqueue({ [inputId]: nextValue });
  }

  function save(submit: boolean) {
    if (submit && !window.confirm(t("Submit Zone {zone} for {team}? It locks once submitted.", { zone: zone.number, team: team.name }))) return;
    setError("");
    startTransition(async () => {
      try {
        if (!await autosave.flush()) return;
        if (!submit) return;
        const result = await saveZoneScore({
          teamId: team.id,
          zoneId: zone.id,
          // The queue already saved the latest fields. Submit the server's
          // merged zone so another operator's fields are never overwritten.
          values: {},
          submit,
        });
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
          return;
        }
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  return (
    <section className="card zone-entry" data-dirty={autosave.dirty || undefined} data-locked={locked || undefined}>
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
                  const next = { ...draftRef.current, [group.minutes.id]: minutes, [group.seconds.id]: seconds };
                  draftRef.current = next;
                  setDraft(next);
                  autosave.enqueue({ [group.minutes.id]: minutes, [group.seconds.id]: seconds });
                  // End is the finish: record the time and submit the zone.
                  save(isComplete([zone], next));
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
                onClick={() => set(group.input.id, (current) => Math.min(current + 1, group.input.maxValue ?? 9999))}
              >
                +1
              </button>
              <button
                type="button"
                className="team-entry-stepper-minus"
                disabled={locked || pending}
                aria-label={`${t(group.input.label)} −1`}
                onClick={() => set(group.input.id, (current) => Math.max(0, current - 1))}
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
            <span role="status" aria-live="polite">
              {autosave.saving ? <><span className="spinner" /> {t("Saving…")}</> : autosave.saved ? t("Saved") : null}
            </span>
            <button type="button" className="btn btn-primary" disabled={pending || !complete} onClick={() => save(true)}>
              {t("Submit zone")}
            </button>
          </span>
        ) : null}
      </div>

      {error || autosave.error ? (
        <div className="notice-error" role="alert" style={{ marginTop: 8 }}>
          {error || t(autosave.error === "NETWORK_ERROR"
            ? "Could not save. Check your connection and try again."
            : ERRORS[autosave.error!] ?? "Something went wrong. Try again.")}
          {autosave.error ? <button type="button" className="btn btn-secondary btn-sm" onClick={autosave.retry} style={{ marginInlineStart: 8 }}>{t("Try again")}</button> : null}
        </div>
      ) : null}
    </section>
  );
}
