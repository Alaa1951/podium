"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { saveScore, unlockScore } from "@/lib/actions/scores";
import { fmt, isOutlier } from "@/lib/scoring";
import { filledCount, totalPoints, type EntryValues, type ZoneDef } from "@/lib/zones";
import { darkLabel, darkValue } from "@/components/scores/score-entry-parts";
import { ZoneCards } from "@/components/scores/zone-cards";

// ─────────────────────────────────────────────────────────────────────────────
// SCORE ENTRY.
//
// The form is DRAWN FROM THE SERIES' ZONE DEFINITION. It used to be four
// hand-written cards with seven named fields, which meant a new zone was a
// code change; now a card appears because a zone exists, and a field appears
// because a movement exists. The operator's screen and the scoring engine can
// no longer disagree about what Series 2 measures.
// ─────────────────────────────────────────────────────────────────────────────

export type SelectedTeam = {
  id: string;
  number: number;
  name: string;
  category: string;
  division: string;
  wave: number;
  competitors: string[];
  submitted: boolean;
  scoreEdits: number;
  /** Raw values, keyed by ZoneInput id. */
  values: EntryValues;
};

type Props = {
  team: SelectedTeam;
  /** This series' zones and movements — the form itself. */
  zones: ZoneDef[];
  /** Totals of the other submitted teams in the same bracket, for the outlier check. */
  peerTotals: number[];
  projectedRank: number;
  isAdmin: boolean;
  /** How many writes a studio gets in total, from the event's own setting. */
  editBudget: number;
  /** Only a studio is bound by that budget — the server's rule, mirrored. */
  budgetApplies?: boolean;
};

export function ScoreEntry({
  team,
  zones,
  peerTotals,
  projectedRank,
  isAdmin,
  editBudget,
  budgetApplies = false,
}: Props) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<EntryValues>(team.values);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // A different team was picked, or this one was saved and re-read: drop
  // whatever was half-typed and start from what the server now holds.
  const [lastTeam, setLastTeam] = useState(team);
  if (lastTeam !== team) {
    setLastTeam(team);
    setDraft(team.values);
    setError("");
    if (lastTeam.id !== team.id) setSaved(false);
  }

  const total = useMemo(() => totalPoints(zones, draft), [zones, draft]);
  const outlier = useMemo(() => isOutlier(total, peerTotals), [total, peerTotals]);
  const progress = useMemo(() => filledCount(zones, draft), [zones, draft]);

  // A studio gets a fixed number of writes; after that only BFT MENA can
  // change the score. The server enforces this too — this only greys the form.
  const studioSpent = budgetApplies && team.scoreEdits >= editBudget;
  const locked = studioSpent;

  function setValue(inputId: string, value: number | null) {
    setDraft((d) => ({ ...d, [inputId]: value }));
  }

  function submit() {
    setError("");
    setSaved(false);
    startTransition(async () => {
      const result = await saveScore({ teamId: team.id, values: draft });
      if (!result.ok) {
        setError(
          result.error === "EDIT_BUDGET_SPENT"
            ? t("This score is locked. Ask BFT MENA to make further corrections.")
            : result.error === "INVALID_SCORE"
              ? t("Check the numbers — a value is negative, not whole, or over the limit.")
              : t("Something went wrong. Try again.")
        );
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function unlock() {
    startTransition(async () => {
      await unlockScore(team.id);
      router.refresh();
    });
  }

  const left = Math.max(0, editBudget - team.scoreEdits);
  const editNote = isAdmin
    ? ""
    : editBudget === 0
      ? t("A saved score is final. Ask BFT MENA for any correction.")
      : left === 0
        ? t("This score is locked. Ask BFT MENA to make further corrections.")
        : team.scoreEdits === 0
          ? t("You may save this score {n} time(s) in total.", { n: editBudget })
          : t("Submitted. {n} save(s) left before it locks.", { n: left });

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 20,
          flexWrap: "wrap",
          borderBottom: "1px solid var(--border)",
          paddingBottom: 16,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--podium-blue)",
            }}
          >
            {t(team.category)} {t(team.division)} · {t("Wave")} {team.wave} · {t("Team")}{" "}
            {team.number}
          </div>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 600,
              fontSize: 38,
              lineHeight: 1.05,
              textTransform: "uppercase",
            }}
          >
            {team.name}
          </div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            {team.competitors.join("  ·  ")}
          </div>
        </div>

        <div
          style={{
            marginInlineStart: "auto",
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span className="badge badge-neutral">
            {progress.filled}/{progress.total} {t("recorded")}
          </span>
          <span className={team.submitted ? "tag tag-outline" : "tag tag-outline-muted"}>
            {team.submitted ? t("SUBMITTED") : t("AWAITING SCORE")}
          </span>
        </div>
      </div>

      <ZoneCards
        zones={zones}
        draft={draft}
        disabled={locked || pending}
        onChange={setValue}
      />

      {outlier ? (
        <div className="notice" style={{ marginTop: 14 }}>
          {t(
            "Check this entry — the total is more than 40% away from the bracket average. Confirm the score sheet before submitting."
          )}
        </div>
      ) : null}

      {error ? (
        <div className="notice-error" style={{ marginTop: 14 }} role="alert">
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          marginTop: 20,
          padding: "18px 20px",
          borderRadius: "var(--r-lg)",
          background: "var(--podium-blue-deep)",
          color: "var(--on-navy)",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={darkLabel}>{t("Calculated total")}</div>
          <div className="pd-num" style={darkValue}>
            {fmt(total, 2)}
          </div>
        </div>
        <div>
          <div style={darkLabel}>
            {t("Rank in")} {t(team.category)} {t(team.division)}
          </div>
          <div className="pd-num" style={darkValue}>
            {projectedRank}
          </div>
        </div>

        <div
          style={{
            marginInlineStart: "auto",
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {editNote ? (
            <span style={{ fontSize: 12, color: "var(--on-navy-strong)", maxWidth: 280 }}>
              {editNote}
            </span>
          ) : null}

          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setDraft(team.values)}
            disabled={pending}
            style={{ color: "var(--on-navy)", borderColor: "var(--on-navy-faint)" }}
          >
            {t("Revert")}
          </button>

          {isAdmin && team.submitted ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={unlock}
              disabled={pending}
              style={{
                background: "transparent",
                color: "var(--on-navy)",
                borderColor: "var(--on-navy-faint)",
              }}
            >
              {t("Unlock for correction")}
            </button>
          ) : null}

          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={locked || pending || zones.length === 0}
          >
            {pending ? <span className="spinner" /> : null}
            {studioSpent
              ? t("Locked")
              : team.submitted
                ? isAdmin
                  ? t("Save correction")
                  : t("Save edit")
                : t("Submit score")}
          </button>
        </div>
      </div>

      {saved ? (
        <div className="notice" style={{ marginTop: 12 }}>
          {t("Saved. The board is updated.")}
        </div>
      ) : null}
    </div>
  );
}
