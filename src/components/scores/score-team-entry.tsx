"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { ClockField } from "@/components/scores/clock-field";
import { FinisherStop } from "@/components/scores/finisher-clock";
import { saveScore } from "@/lib/actions/scores";
import { fmt } from "@/lib/scoring";
import { teamStatus, teamStatusLabel, teamStatusTone } from "@/lib/team-status";
import {
  groupInputs,
  isCounted,
  totalPoints,
  zonePoints,
  type EntryValues,
  type ZoneDef,
} from "@/lib/zones";

import { halfOf, scoreErrorMessage, show } from "@/components/scores/score-grid-row";
import type { GridTeam } from "@/components/scores/score-grid-types";

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
  onBack: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<EntryValues>(team.values);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // The server re-read this team: drop anything half-typed and take what it
  // now holds, so the screen never keeps showing a value the database refused.
  const [seen, setSeen] = useState(team);
  if (seen !== team) {
    setSeen(team);
    setDraft(team.values);
    setError("");
  }

  // The budget is a studio's limit, and only a studio's — see ScoreGridRow.
  const spent = budgetApplies && team.scoreEdits >= editBudget;
  const locked = spent || frozen;
  const total = totalPoints(zones, draft);
  const rank = 1 + team.peerTotals.filter((peer) => peer > total).length;
  const dirty = zones.some((zone) =>
    zone.inputs.some((input) => (draft[input.id] ?? null) !== (team.values[input.id] ?? null))
  );
  const status = teamStatus(team);

  function set(inputId: string, value: number | null) {
    setSaved(false);
    setDraft((d) => ({ ...d, [inputId]: value }));
  }

  function save(values: EntryValues = draft) {
    setError("");
    setSaved(false);
    startTransition(async () => {
      const result = await saveScore({ teamId: team.id, values });
      if (!result.ok) {
        setError(scoreErrorMessage(result.error, t));
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="team-entry">
      <button type="button" className="team-entry-back" onClick={onBack}>
        ← {t("Back to the list")}
      </button>

      <div className="team-entry-head">
        <span className="pd-num team-entry-num">{team.number}</span>
        <span className="team-entry-id">
          <span className="team-entry-name">{team.name}</span>
          <span className="grid-team-people">{team.competitors.join(" · ")}</span>
          <span className="grid-team-bracket">
            {t(team.category)} · {t(team.division)} · {t("Wave")} {team.wave}
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
                  disabled={locked || pending}
                  onChange={set}
                  label={t("Time remaining")}
                />
                {waveEndsAt ? (
                  <FinisherStop
                    endsAt={waveEndsAt}
                    disabled={locked || pending}
                    onCapture={({ minutes, seconds }) => {
                      const next = {
                        ...draft,
                        [group.minutes.id]: minutes,
                        [group.seconds.id]: seconds,
                      };
                      setDraft(next);
                      save(next);
                    }}
                  />
                ) : null}
              </div>
            ) : isCounted(group.input) ? (
              // Counted movement: the whole slab is the button, and the count
              // sits right under it — nothing small to aim for.
              <div key={group.input.id} className="team-entry-field">
                <button
                  type="button"
                  className="team-entry-stepper"
                  disabled={locked || pending}
                  aria-label={`${t(group.input.label)} +1`}
                  onClick={() =>
                    set(
                      group.input.id,
                      Math.min((draft[group.input.id] ?? 0) + 1, group.input.maxValue ?? 9999)
                    )
                  }
                >
                  +1
                </button>
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
                  disabled={locked || pending}
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

      <button
        type="button"
        className="btn btn-primary team-entry-save"
        onClick={() => save()}
        disabled={locked || pending || zones.length === 0 || !dirty}
      >
        {pending ? <span className="spinner" /> : null}
        {locked ? t("Locked") : saved && !dirty ? t("Saved") : t("Save")}
      </button>

      {error ? (
        <div className="notice-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
