"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { ClockField } from "@/components/scores/clock-field";
import { ScoreEntry } from "@/components/scores/score-entry";
import { saveScore } from "@/lib/actions/scores";
import { fmt } from "@/lib/scoring";
import { teamStatus, teamStatusLabel, teamStatusTone } from "@/lib/team-status";
import {
  groupInputs,
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
  isAdmin,
  frozen,
  onExpand,
  expanded,
}: {
  team: GridTeam;
  zones: ZoneDef[];
  editBudget: number;
  isAdmin: boolean;
  /** The series has closed score entry, or this account may not enter at all. */
  frozen: boolean;
  onExpand: () => void;
  expanded: boolean;
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

  const spent = !isAdmin && team.scoreEdits >= editBudget;
  // While the card is open below, it is the editor — see the comment there.
  const locked = spent || frozen || expanded;
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

  function save() {
    setError("");
    setSaved(false);
    startTransition(async () => {
      const result = await saveScore({ teamId: team.id, values: draft });
      if (!result.ok) {
        setError(message(result.error, t));
        return;
      }
      setSaved(true);
      router.refresh();
    });
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
                  <ClockField
                    key={group.minutes.id}
                    minutes={halfOf(group.minutes.id, group.minutes.maxValue, draft)}
                    seconds={halfOf(group.seconds.id, group.seconds.maxValue, draft)}
                    disabled={locked || pending}
                    onChange={set}
                    size="sm"
                    label={t("Time remaining")}
                  />
                ) : (
                  <input
                    key={group.input.id}
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
            onClick={save}
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
              isAdmin={isAdmin}
              editBudget={frozen ? 0 : editBudget}
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

const show = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

const halfOf = (id: string, maxValue: number | null, draft: EntryValues) => ({
  id,
  value: draft[id],
  maxValue,
});

/** The server's refusal codes, in words an operator can act on. */
function message(code: string, t: (key: string) => string) {
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
