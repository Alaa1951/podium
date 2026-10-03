"use client";

import { useRouter } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { ClockField } from "@/components/scores/clock-field";
import { FinisherStop } from "@/components/scores/finisher-clock";
import { useScoreAutosave } from "@/components/scores/use-score-autosave";
import { saveScore } from "@/lib/actions/scores";
import { fmt } from "@/lib/scoring";
import type { ScorePatch } from "@/lib/score-autosave";
import { teamStatus, teamStatusLabel, teamStatusTone } from "@/lib/team-status";
import {
  groupInputs,
  isCounted,
  keepTyping,
  totalPoints,
  zonePoints,
  type EntryValues,
  type ZoneDef,
} from "@/lib/zones";

import { halfOf, scoreErrorMessage, show } from "@/components/scores/score-grid-row";
import type { GridTeam } from "@/components/scores/score-grid-types";
import { useUnsavedChanges } from "@/components/app/mobile-runtime";

// ─────────────────────────────────────────────────────────────────────────────
// THE PHONE'S ENTRY SCREEN: one team, nothing else on the page.
//
// A judge standing on the floor works with a thumb and a glance. Tapping a
// team on the sheet opens this screen — that team's movements, one per block,
// each counted movement a single huge slab to hit and its count right under
// it, so a gloved hand cannot miss and a raised knee cannot hide the number.
// Back returns to the sheet at its top: the list is never half-scrolled
// sideways through.
// ─────────────────────────────────────────────────────────────────────────────

export function ScoreTeamEntry({
  team,
  zones,
  editBudget,
  budgetApplies = false,
  frozen,
  waveEndsAt,
  finisherWorkMinutes = 15,
  waveEnded = false,
  canEditAfterClose = false,
  onBack,
}: {
  team: GridTeam;
  zones: ZoneDef[];
  editBudget: number;
  /** Only a studio is bound by the edit budget — the server's rule, mirrored. */
  budgetApplies?: boolean;
  /** The series has closed score entry, or this account may not enter at all. */
  frozen: boolean;
  /** When this team's wave clock runs out — the finisher stop reads it. */
  waveEndsAt?: string | null;
  /** One zone's work in minutes — the finisher is the wave's last this-many. */
  finisherWorkMinutes?: number;
  /** True once that clock has run out. */
  waveEnded?: boolean;
  /** Full admins, and accounts granted the after-close permission. */
  canEditAfterClose?: boolean;
  onBack: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<EntryValues>(team.values);
  const draftRef = useRef<EntryValues>(team.values);
  useLayoutEffect(() => { draftRef.current = draft; }, [draft]);
  const [error, setError] = useState("");
  const saveDraft = useCallback((values: ScorePatch) => saveScore({ teamId: team.id, values, autosave: true }), [team.id]);
  const autosave = useScoreAutosave(saveDraft);

  // The server re-read this team: values still being typed are kept, a zone a
  // judge has just submitted takes the server's values (see ScoreGridRow).
  const [seen, setSeen] = useState(team);
  if (seen !== team) {
    setSeen(team);
    setDraft(seen.id !== team.id ? team.values : keepTyping(zones, draft, seen.values, team.values, canEditAfterClose ? [] : team.lockedZones ?? []));
    setError("");
  }

  // The budget is a studio's limit, and only a studio's — see ScoreGridRow.
  const spent = budgetApplies && team.scoreEdits >= editBudget;
  const waveLocked = waveEnded && !canEditAfterClose;
  const locked = spent || frozen || waveLocked || (team.submitted && !canEditAfterClose);
  const zoneLocked = (zoneId: string) => locked || (!canEditAfterClose && (team.lockedZones ?? []).includes(zoneId));
  const total = totalPoints(zones, draft);
  const rank = 1 + team.peerTotals.filter((peer) => peer > total).length;
  const dirty = zones.some((zone) =>
    zone.inputs.some((input) => (draft[input.id] ?? null) !== (team.values[input.id] ?? null))
  );
  const status = teamStatus(team);
  useUnsavedChanges(autosave.dirty || pending);

  function set(inputId: string, value: number | null | ((current: number) => number)) {
    const nextValue = typeof value === "function" ? value(draftRef.current[inputId] ?? 0) : value;
    const next = { ...draftRef.current, [inputId]: nextValue };
    draftRef.current = next;
    setDraft(next);
    setError("");
    autosave.enqueue({ [inputId]: nextValue });
  }

  function submit() {
    setError("");
    startTransition(async () => {
      try {
        if (!await autosave.flush()) return;
        // Finalization reads the merged server values after the latest tap.
        const result = await saveScore({ teamId: team.id, values: {} });
        if (!result.ok) {
          setError(scoreErrorMessage(result.error, t));
          return;
        }
        router.refresh();
      } catch { setError(t("Could not save. Check your connection and try again.")); }
    });
  }

  return (
    <div className="team-entry">
      <button type="button" className="team-entry-back" disabled={pending} onClick={() => {
        startTransition(async () => { if (await autosave.flush()) onBack(); });
      }}>
        ← {t("Back to the list")}
      </button>

      {waveLocked ? (
        <div className="notice" role="status">
          {t("The wave clock has ended — this score is locked.")}
        </div>
      ) : null}

      <div className="team-entry-head">
        {/* The pair, so whoever is entering a score can see they have the right
            team in front of them without reading two names off a sheet. */}
        {team.groupPortraitPath ? (
          // A fixed-size thumbnail of a path we already serve.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={team.groupPortraitPath}
            alt=""
            className="team-entry-photo"
          />
        ) : null}
        <span className="pd-num team-entry-num">{team.number}</span>
        <span className="team-entry-id">
          <span className="team-entry-name">{team.name}</span>
          <span className="grid-team-people">{team.competitors.join(" · ")}</span>
          <span className="grid-team-bracket">
            {t(team.category)} · {t(team.division)} · {team.wave === null ? t("Without wave") : `${t("Wave")} ${team.wave}`}
          </span>
        </span>
        <span className={`badge ${teamStatusTone(status)}`}>{t(teamStatusLabel(status))}</span>
      </div>

      {zones.map((zone) => (
        <div key={zone.id} className="team-entry-zone">
          <div className="team-entry-zone-head">
            <span className="card-kicker">
              {t("Zone")} {zone.number} {"///"} {t(zone.name)}
            </span>
            <span className="pd-num team-entry-zone-pts">{fmt(zonePoints(zone, draft), 2)}</span>
          </div>

          {groupInputs(zone).map((group) =>
            group.kind === "clock" ? (
              <div key={group.minutes.id} className="team-entry-field">
                <span className="team-entry-label">{t("Time remaining")}</span>
                <ClockField
                  minutes={halfOf(group.minutes.id, group.minutes.maxValue, draft)}
                  seconds={halfOf(group.seconds.id, group.seconds.maxValue, draft)}
                  disabled={zoneLocked(zone.id) || pending}
                  onChange={set}
                  label={t("Time remaining")}
                />
                {waveEndsAt ? (
                  <FinisherStop
                    endsAt={waveEndsAt}
                    workMinutes={finisherWorkMinutes}
                    disabled={zoneLocked(zone.id) || pending}
                    onCapture={({ minutes, seconds }) => {
                      const next = {
                        ...draftRef.current,
                        [group.minutes.id]: minutes,
                        [group.seconds.id]: seconds,
                      };
                      draftRef.current = next;
                      setDraft(next);
                      autosave.enqueue({ [group.minutes.id]: minutes, [group.seconds.id]: seconds });
                      submit();
                    }}
                  />
                ) : null}
              </div>
            ) : isCounted(group.input) ? (
              // Counted movement: the wide slab counts up, the narrow one
              // takes a mis-tap back — 80/20 so the thumb lands on +1 by default.
              <div key={group.input.id} className="team-entry-field">
                <div className="team-entry-stepper-row">
                  <button
                    type="button"
                    className="team-entry-stepper"
                    disabled={zoneLocked(zone.id) || pending}
                    aria-label={`${t(group.input.label)} +1`}
                    onClick={() =>
                      set(
                        group.input.id,
                        (current) => Math.min(current + 1, group.input.maxValue ?? 9999)
                      )
                    }
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    className="team-entry-stepper-minus"
                    disabled={zoneLocked(zone.id) || pending}
                    aria-label={`${t(group.input.label)} −1`}
                    onClick={() => set(group.input.id, (current) => Math.max(0, current - 1))}
                  >
                    −1
                  </button>
                </div>
                <div className="team-entry-count">
                  <span className="pd-num team-entry-count-value">
                    {draft[group.input.id] ?? 0}
                  </span>
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
                  disabled={zoneLocked(zone.id) || pending}
                  onChange={(e) =>
                    set(
                      group.input.id,
                      e.target.value.trim() === "" ? null : Number(e.target.value)
                    )
                  }
                />
              </div>
            )
          )}
        </div>
      ))}

      <div className="team-entry-foot">
        <span className="grid-card-pair">
          {t("Total")} <strong className="pd-num">{fmt(total, 2)}</strong>
        </span>
        <span className="grid-card-pair">
          {t("Rank")}{" "}
          <strong className="pd-num">{team.submitted || dirty ? rank : "—"}</strong>
        </span>
      </div>

      <div role="status" aria-live="polite">
        {autosave.saving ? <><span className="spinner" /> {t("Saving…")}</> : autosave.saved ? t("Saved") : null}
      </div>

      <button
        type="button"
        className="btn btn-primary team-entry-save team-entry-submit"
        onClick={submit}
        disabled={locked || pending || zones.length === 0 || !zones.some((zone) => zone.inputs.every((input) => draft[input.id] != null))}
      >
        {pending ? <span className="spinner" /> : null}
        {locked ? t("Locked") : t("Submit score")}
      </button>

      {error || autosave.error ? (
        <div className="notice-error" role="alert">
          {error || (autosave.error === "NETWORK_ERROR"
            ? t("Could not save. Check your connection and try again.")
            : scoreErrorMessage(autosave.error!, t))}
          {autosave.error ? <button type="button" className="btn btn-secondary btn-sm" onClick={autosave.retry} style={{ marginInlineStart: 8 }}>{t("Try again")}</button> : null}
        </div>
      ) : null}
    </div>
  );
}
