"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { ClockField } from "@/components/scores/clock-field";
import { FinisherStop } from "@/components/scores/finisher-clock";
import { ScoreEntry } from "@/components/scores/score-entry";
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

import type { GridTeam } from "@/components/scores/score-grid-types";

// One team's line on the score sheet: its fields, its running total, its SAVE.
// The arithmetic is lib/zones.ts — the same functions the server scores with, so
// the number under the operator's hand is the number that lands on the board.

export function ScoreGridRow({
  team,
  zones,
  editBudget,
  budgetApplies = false,
  isAdmin,
  frozen,
  onExpand,
  expanded,
  mobile = false,
}: {
  team: GridTeam;
  zones: ZoneDef[];
  editBudget: number;
  /** Only a studio is bound by the edit budget — the server's rule, mirrored. */
  budgetApplies?: boolean;
  isAdmin: boolean;
  /** The series has closed score entry, or this account may not enter at all. */
  frozen: boolean;
  onExpand: () => void;
  expanded: boolean;
  /** ≤720px: a stacked card instead of a table row — no sideways scrolling. */
  mobile?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<EntryValues>(team.values);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // The server re-read this team: drop anything half-typed and take what it now
  // holds, so a row never keeps showing a value the database refused.
  const [seen, setSeen] = useState(team);
  if (seen !== team) {
    setSeen(team);
    setDraft(team.values);
    setError("");
  }

  // The budget is a studio's limit, and only a studio's: admins write freely,
  // and a wave scorer writes through the grant. Mirrors canEditScore on the
  // server — when these two disagree, a judge stares at dead buttons.
  const spent = budgetApplies && team.scoreEdits >= editBudget;
  // On the desktop sheet the one-team card opens below and becomes the editor,
  // so the row's own fields step aside while it is open. On mobile the card's
  // stacked fields ARE the editor — opening it must not lock them.
  const locked = spent || frozen || (!mobile && expanded);
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

  // The phone sheet: one collapsed card per team — number, name, live total,
  // status. Tapping it opens that team's own full entry screen (the one-team
  // editor lives in score-team-entry), so the sheet itself stays a list and
  // never scrolls sideways or half-open.
  if (mobile) {
    return (
      <div className="grid-card" data-submitted={team.submitted || undefined}>
        <button
          type="button"
          className="grid-card-head"
          onClick={onExpand}
          aria-expanded={expanded}
        >
          <span className="grid-card-num pd-num">{team.number}</span>
          <span className="grid-card-id">
            <span className="grid-team-name">{team.name}</span>
            <span className="grid-team-people">{team.competitors.join(" · ")}</span>
            <span className="grid-team-bracket">
              {t(team.category)} · {t(team.division)} · {t("Wave")} {team.wave}
            </span>
          </span>
          <span className="grid-card-meta">
            {dirty ? <span className="grid-card-dirty" title={t("Unsaved changes")} /> : null}
            <span className="grid-card-total pd-num">{fmt(total, 2)}</span>
            <span className={`badge ${teamStatusTone(status)}`}>{t(teamStatusLabel(status))}</span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <>
      <tr data-submitted={team.submitted || undefined}>
        <td className="pd-num">{team.number}</td>

        <td>
          <button type="button" className="linkish grid-team" onClick={onExpand}>
            <span className="grid-team-name">{team.name}</span>
            <span className="grid-team-people">{team.competitors.join(" · ")}</span>
          </button>
          <div className="grid-team-bracket">
            {t(team.category)} · {t(team.division)} · {t("Wave")} {team.wave}
          </div>
        </td>

        {zones.map((zone) => (
          <td key={zone.id} className="grid-zone">
            <div className="grid-zone-fields">
              {groupInputs(zone).map((group) =>
                group.kind === "clock" ? (
                  <div key={group.minutes.id} style={{ display: "grid", gap: 4 }}>
                    <ClockField
                      minutes={halfOf(group.minutes.id, group.minutes.maxValue, draft)}
                      seconds={halfOf(group.seconds.id, group.seconds.maxValue, draft)}
                      disabled={locked || pending}
                      onChange={set}
                      size="sm"
                      label={t("Time remaining")}
                    />
                    {team.waveEndsAt ? (
                      <FinisherStop
                        endsAt={team.waveEndsAt}
                        disabled={locked || pending}
                        onCapture={({ minutes, seconds }) => {
                          const next = { ...draft, [group.minutes.id]: minutes, [group.seconds.id]: seconds };
                          setDraft(next);
                          save(next);
                        }}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div key={group.input.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      className="input pd-num grid-input"
                      type="number"
                      min={0}
                      max={group.input.maxValue ?? undefined}
                      aria-label={`${team.name} — ${t(group.input.label)}`}
                      title={t(group.input.label)}
                      value={show(draft[group.input.id])}
                      disabled={locked || pending}
                      onChange={(e) =>
                        set(group.input.id, e.target.value.trim() === "" ? null : Number(e.target.value))
                      }
                    />
                    {isCounted(group.input) ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-cyan"
                        disabled={locked || pending}
                        aria-label={`${t(group.input.label)} +1`}
                        title={`+1 ${t(group.input.label)}`}
                        onClick={() =>
                          set(group.input.id, Math.min((draft[group.input.id] ?? 0) + 1, group.input.maxValue ?? 9999))
                        }
                        style={{
                          minWidth: 32,
                          height: 32,
                          fontSize: 16,
                          fontWeight: 700,
                          padding: 0,
                          flex: "none",
                        }}
                      >
                        +1
                      </button>
                    ) : null}
                  </div>
                )
              )}
            </div>
            <div className="grid-zone-pts pd-num">{fmt(zonePoints(zone, draft), 2)}</div>
          </td>
        ))}

        <td className="grid-total pd-num">{fmt(total, 2)}</td>
        <td className="pd-num grid-rank">{team.submitted || dirty ? rank : "—"}</td>

        <td>
          <span className={`badge ${teamStatusTone(status)}`}>{t(teamStatusLabel(status))}</span>
        </td>

        <td>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => save()}
            disabled={locked || pending || zones.length === 0 || !dirty}
          >
            {pending ? <span className="spinner" /> : null}
            {locked ? t("Locked") : saved && !dirty ? t("Saved") : t("Save")}
          </button>
        </td>
      </tr>

      {error ? (
        <tr>
          <td colSpan={zones.length + 6}>
            <div className="notice-error" role="alert">
              {error}
            </div>
          </td>
        </tr>
      ) : null}

      {expanded ? (
        <tr>
          <td colSpan={zones.length + 6} className="grid-expanded">
            {/* One editor at a time. The card starts from whatever is in the
                row — including anything typed and not yet saved — and the row's
                own fields are disabled above, so the two can never show
                different numbers for the same team. */}
            <ScoreEntry
              team={{ ...team, values: draft }}
              zones={zones}
              peerTotals={team.peerTotals}
              projectedRank={rank}
              budgetApplies={budgetApplies}
              isAdmin={isAdmin}
              editBudget={frozen ? 0 : editBudget}
              waveEndsAt={team.waveEndsAt}
            />

            {team.audit.length > 0 ? (
              <div style={{ marginTop: 22 }}>
                <div className="console-group-title">{t("Every change to this score")}</div>
                <ul className="audit-lines">
                  {team.audit.map((line) => (
                    <li key={line.id}>
                      <span className="pd-num">{line.at}</span>
                      <strong>{line.field}</strong>
                      <span className="pd-num">
                        {line.oldValue ?? "—"} → {line.newValue ?? "—"}
                      </span>
                      <span className="muted">{line.operator}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export const show = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

export const halfOf = (id: string, maxValue: number | null, draft: EntryValues) => ({
  id,
  value: draft[id],
  maxValue,
});

/** The server's refusal codes, in words an operator can act on. */
export function scoreErrorMessage(code: string, t: (key: string) => string) {
  switch (code) {
    case "EDIT_BUDGET_SPENT":
      return t("This score is locked. Ask BFT MENA to make further corrections.");
    case "SCORE_ENTRY_CLOSED":
      return t("Score entry has closed for this competition.");
    case "FORBIDDEN":
      return t("You may not enter scores for this team.");
    case "INVALID_SCORE":
      return t("Check the numbers — a value is negative, not whole, or over the limit.");
    default:
      return t("Something went wrong. Try again.");
  }
}
