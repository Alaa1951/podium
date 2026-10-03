"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";

import { useUnsavedChanges } from "@/components/app/mobile-runtime";
import { useT } from "@/components/i18n/locale-provider";
import { ClockField } from "@/components/scores/clock-field";
import { FinisherStop } from "@/components/scores/finisher-clock";
import { halfOf, show } from "@/components/scores/score-grid-row";
import { useScoreAutosave } from "@/components/scores/use-score-autosave";
import { saveZoneScore } from "@/lib/actions/scores";
import { fmt } from "@/lib/scoring";
import { isCurrentScoreSnapshot, type ScorePatch } from "@/lib/score-autosave";
import { groupInputs, isComplete, isCounted, keepTyping, MAX_ENTRY_VALUE, validateEntries, zonePoints, type EntryValues, type ZoneDef } from "@/lib/zones";

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
  /** A new start after Reset creates a fresh autosave queue for this team. */
  waveStartedAt?: string | null;
  values: EntryValues;
  /** Monotonic database revision shared by the values and submission lock. */
  scoreRevision?: string | null;
  locked: boolean;
  /** The wave clock's end — the finisher's clock in the last zone. */
  waveEndsAt: string | null;
  /** One zone's work in minutes — the finisher is the wave's last this-many. */
  finisherWorkMinutes: number;
  /** The leader's zone window, or the competition cut-off if it comes first. */
  entryClosesAt?: string | null;
  entryDeadlineReason?: string;
  /** Server-confirmed closure (including an early End or removed write access). */
  entryClosedReason?: string | null;
};

const ERRORS: Record<string, string> = {
  SCORE_LOCKED: "This zone is submitted and locked. Ask BFT MENA for any correction.",
  WRONG_STATION: "This team is not on your station.",
  NO_STATION: "Your zone leader has not placed you on a station yet.",
  WAVE_NOT_HERE: "This wave has not reached your zone yet.",
  WAVE_RESTARTED: "This wave restarted. Reload your score sheet before entering scores.",
  WAVE_MOVED_ON: "The next wave has reached your zone, so this team is closed for you. Ask BFT MENA for any correction.",
  SERIES_NOT_LIVE: "The competition is not running.",
  SCORE_ENTRY_CLOSED: "Score entry has closed for this competition.",
  ZONE_ENTRY_CLOSED: "Score entry for this zone has ended. Ask BFT MENA for any correction.",
  INCOMPLETE: "Fill in every field before submitting.",
  INVALID_SCORE: "A value is out of range.",
  FORBIDDEN: "You are not allowed to score this.",
};

const CLOSED_ERRORS = new Set([
  "ZONE_ENTRY_CLOSED", "SCORE_ENTRY_CLOSED", "SCORE_LOCKED", "SERIES_NOT_LIVE",
  "FORBIDDEN", "WAVE_NOT_HERE", "WAVE_RESTARTED", "WAVE_MOVED_ON", "NO_STATION", "WRONG_STATION",
]);

export function ZoneEntryCard({ team, zone, canEnterCountDirectly = false }: {
  team: ZoneEntryTeam;
  zone: ZoneDef;
  canEnterCountDirectly?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<EntryValues>(team.values);
  const [serverScore, setServerScore] = useState({ revision: team.scoreRevision, values: team.values, locked: team.locked });
  const locked = serverScore.locked;
  const draftRef = useRef<EntryValues>(team.values);
  useLayoutEffect(() => { draftRef.current = draft; }, [draft]);
  const [error, setError] = useState("");
  const [entryVersion, setEntryVersion] = useState(0);
  const saveDraft = useCallback((values: ScorePatch) => saveZoneScore({
    teamId: team.id, zoneId: zone.id, values, submit: false, autosave: true,
    waveStartedAt: team.waveStartedAt ?? undefined,
  }), [team.id, team.waveStartedAt, zone.id]);
  const autosave = useScoreAutosave(saveDraft, `${team.waveStartedAt ?? ""}:${entryVersion}`);
  const { terminate } = autosave;
  const [expiredDeadline, setExpiredDeadline] = useState<string | null>(null);
  const deadlineReason = team.entryDeadlineReason ?? "ZONE_ENTRY_CLOSED";
  const closedReason = team.entryClosedReason
    || (team.entryClosesAt && expiredDeadline === team.entryClosesAt ? deadlineReason : null)
    || (autosave.error && CLOSED_ERRORS.has(autosave.error) ? autosave.error : null);

  // A write can discover a revoked post or an early End before the next poll.
  // Keep that rejection final across reconnect and visibility retries.
  useEffect(() => {
    if (autosave.error && CLOSED_ERRORS.has(autosave.error)) terminate(autosave.error);
  }, [autosave.error, terminate]);

  // Closing must not depend on a server refresh: the sheet deliberately keeps
  // refreshing away from focused inputs, and a phone can be backgrounded.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (timer) clearTimeout(timer);
      if (locked) return;
      if (team.entryClosedReason) {
        terminate(team.entryClosedReason);
        return;
      }
      if (!team.entryClosesAt) return;
      const remaining = new Date(team.entryClosesAt).getTime() - Date.now();
      if (remaining <= 0) {
        setExpiredDeadline(team.entryClosesAt);
        terminate(deadlineReason);
      } else {
        timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
      }
    };
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [team.entryClosesAt, team.entryClosedReason, locked, deadlineReason, terminate]);

  // Refreshes can finish after a more recent save. Only current database
  // revisions replace values or locks; fresh snapshots include another
  // operator's edits, while local unsaved typing is preserved against the
  // last accepted server values. A restarted wave starts a new snapshot.
  const [seen, setSeen] = useState(team);
  if (seen !== team) {
    setSeen(team);
    const restarted = seen.id !== team.id || seen.waveStartedAt !== team.waveStartedAt;
    const currentScore = restarted || isCurrentScoreSnapshot(team.scoreRevision, serverScore.revision, autosave.revision);
    if ((currentScore && serverScore.locked && !team.locked) || (seen.entryClosedReason && !team.entryClosedReason)) setEntryVersion((version) => version + 1);
    if (currentScore) {
      setServerScore({ revision: team.scoreRevision, values: team.values, locked: team.locked });
      setDraft(restarted || (!autosave.dirty && !pending)
        ? team.values
        : keepTyping([zone], draft, serverScore.values, team.values, team.locked ? [zone.id] : []));
    }
    setError("");
  }

  useUnsavedChanges(autosave.dirty || pending);
  const readOnly = locked || !!closedReason;
  const complete = isComplete([zone], draft);

  const closedNow = useCallback(() => {
    if (readOnly) return true;
    if (team.entryClosesAt && Date.now() >= new Date(team.entryClosesAt).getTime()) {
      setExpiredDeadline(team.entryClosesAt);
      terminate(deadlineReason);
      return true;
    }
    return false;
  }, [readOnly, team.entryClosesAt, deadlineReason, terminate]);

  function set(inputId: string, value: number | null | ((current: number) => number)) {
    if (closedNow()) return;
    const nextValue = typeof value === "function" ? value(draftRef.current[inputId] ?? 0) : value;
    if (validateEntries([zone], { [inputId]: nextValue }).length) {
      setError(t("Enter a whole number within the allowed range."));
      return;
    }
    const next = { ...draftRef.current, [inputId]: nextValue };
    draftRef.current = next;
    setDraft(next);
    setError("");
    autosave.enqueue({ [inputId]: nextValue });
  }

  function save(submit: boolean) {
    if (closedNow()) return;
    if (submit && !window.confirm(t("Submit Zone {zone} for {team}? It locks once submitted.", { zone: zone.number, team: team.name }))) return;
    setError("");
    startTransition(async () => {
      try {
        if (!await autosave.flush()) return;
        if (!submit) return;
        if (closedNow()) return;
        const result = await saveZoneScore({
          teamId: team.id,
          zoneId: zone.id,
          waveStartedAt: team.waveStartedAt ?? undefined,
          // The queue already saved the latest fields. Submit the server's
          // merged zone so another operator's fields are never overwritten.
          values: {},
          submit,
        });
        if (!result.ok) {
          if (CLOSED_ERRORS.has(result.error)) autosave.terminate(result.error);
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
    <section className="card zone-entry" data-dirty={autosave.dirty || undefined} data-locked={locked || undefined} data-entry-closed={!!closedReason || undefined}>
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
          {locked ? t("Submitted") : closedReason ? t("Closed") : t("Open")}
        </span>
      </div>

      {groupInputs(zone).map((group) =>
        group.kind === "clock" ? (
          <div key={group.minutes.id} className="team-entry-field">
            <span className="team-entry-label">{t("Time remaining")}</span>
            <ClockField
              minutes={halfOf(group.minutes.id, group.minutes.maxValue, draft)}
              seconds={halfOf(group.seconds.id, group.seconds.maxValue, draft)}
              disabled={readOnly || pending}
              onChange={set}
              label={t("Time remaining")}
            />
            {team.waveEndsAt && !readOnly ? (
              <FinisherStop
                endsAt={team.waveEndsAt}
                workMinutes={team.finisherWorkMinutes}
                disabled={pending}
                onCapture={({ minutes, seconds }) => {
                  if (closedNow()) return;
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
                disabled={readOnly || pending}
                aria-label={`${t(group.input.label)} +1`}
                onClick={() => set(group.input.id, (current) => Math.min(current + 1, group.input.maxValue ?? (canEnterCountDirectly ? MAX_ENTRY_VALUE : 9999)))}
              >
                +1
              </button>
              <button
                type="button"
                className="team-entry-stepper-minus"
                disabled={readOnly || pending}
                aria-label={`${t(group.input.label)} −1`}
                onClick={() => set(group.input.id, (current) => Math.max(0, current - 1))}
              >
                −1
              </button>
            </div>
            <div className="team-entry-count">
              {canEnterCountDirectly ? (
                <input
                  className="input pd-num team-entry-number"
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={0}
                  max={group.input.maxValue ?? MAX_ENTRY_VALUE}
                  aria-label={t(group.input.label)}
                  value={show(draft[group.input.id])}
                  disabled={readOnly || pending}
                  onChange={(e) => set(group.input.id, e.target.value.trim() === "" ? null : Number(e.target.value))}
                />
              ) : <span className="pd-num team-entry-count-value">{draft[group.input.id] ?? 0}</span>}
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
              step={1}
              max={group.input.maxValue ?? MAX_ENTRY_VALUE}
              aria-label={t(group.input.label)}
              value={show(draft[group.input.id])}
              disabled={readOnly || pending}
              onChange={(e) => set(group.input.id, e.target.value.trim() === "" ? null : Number(e.target.value))}
            />
          </div>
        )
      )}

      <div className="zone-entry-foot">
        <span className="grid-card-pair">
          {t("Zone")} {zone.number} <strong className="pd-num">{fmt(zonePoints(zone, draft), 2)}</strong>
        </span>
        {!readOnly ? (
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

      {closedReason && !locked ? (
        <div className="notice" role="status" style={{ marginTop: 8 }}>
          {t(ERRORS[closedReason] ?? "You are not allowed to score this.")}
          {autosave.dirty ? <p>{t("Some changes were not saved before entry closed. Ask BFT MENA to record them.")}</p> : null}
        </div>
      ) : null}

      {error || (autosave.error && !closedReason) ? (
        <div className="notice-error" role="alert" style={{ marginTop: 8 }}>
          {error || t(autosave.error === "NETWORK_ERROR"
            ? "Could not save. Check your connection and try again."
            : ERRORS[autosave.error!] ?? "Something went wrong. Try again.")}
          {autosave.error && !readOnly ? <button type="button" className="btn btn-secondary btn-sm" onClick={autosave.retry} style={{ marginInlineStart: 8 }}>{t("Try again")}</button> : null}
        </div>
      ) : null}
    </section>
  );
}
