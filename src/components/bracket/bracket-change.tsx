"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { assistBracketChange, changeMyBracket } from "@/lib/actions/bracket";
import { levelChoices, type BracketFacts } from "@/lib/bracket";
import { CATEGORIES } from "@/lib/scoring";

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE CATEGORY OR LEVEL — one panel, two people who may press it:
//
//   the ATHLETE, on their own page, for the team they are on;
//   STAFF, on a team they can open — and then only after ticking that the
//   athlete asked for the change and approves it.
//
// WHEN is two clocks (bracket.ts): the athlete and their gym until the
// competition's own cutoff (Settings → Team changes, 24 hours by default);
// BFT MENA and event staff until a score is entered for the team. The panel
// says which applies, and when it closes or closed.
//
// It offers exactly what the server will accept (bracket.ts): a category this
// pair cannot enter is shown, disabled, with the reason beside it; Pro is
// BFT MENA's. It says what changes and what stays before anything is saved.
// The server decides everything again (bracket-change.ts).
// ─────────────────────────────────────────────────────────────────────────────

const CLOSED_ATHLETE: Record<string, string> = {
  PROTECTED_SLOT: "Your team's wave was arranged by hand. Ask at the desk to change your category.",
  TEAM_EDIT_CLOSED: "Changes to your category and level closed on {when} (Qatar time). BFT MENA can still change it for you until your team has a score — ask at the desk.",
  WAVE_STARTED: "Your wave has started, so your category and level cannot change now.",
  TEAM_ALREADY_SCORED: "Your team has a score, so your category and level cannot change now.",
  SERIES_FINISHED: "This competition is finished.",
  NOT_FOUND: "This team is no longer entered.",
};

const CLOSED_STAFF: Record<string, string> = {
  PROTECTED_SLOT: "This team runs manually in another category's block. Move it, or return it to Auto Assign on the Waves screen, before changing its category.",
  TEAM_EDIT_CLOSED: "Changes to this team's category and level closed on {when} (Qatar time). BFT MENA can still change it until the team has a score.",
  WAVE_STARTED: "This team's wave has started, so its category and level cannot change now.",
  TEAM_ALREADY_SCORED: "This team has a score, so its category and level cannot change now.",
  SERIES_FINISHED: "This competition is finished.",
  NOT_FOUND: "This team is no longer entered.",
};

const BLOCKED: Record<string, string> = {
  WOMENS_HAS_A_MAN: "Womens is not available: a member of this team is registered as a man.",
  MENS_HAS_A_WOMAN: "Mens is not available: a member of this team is registered as a woman.",
};

const ERRORS: Record<string, string> = {
  ...BLOCKED,
  PRO_IS_BFT_MENA: "Moving into or out of Pro is done by BFT MENA.",
  STALE_BRACKET: "This team's category or level changed while this was open. Reload to see it as it is now.",
  APPROVAL_REQUIRED: "Confirm that the athlete asked for this change and approves it.",
  FORBIDDEN: "You are not allowed to do that.",
  UNAUTHENTICATED: "You are signed out. Sign in and try again.",
  INVALID_INPUT: "Check the fields and try again.",
};

export function BracketChange({
  facts,
  mode,
  teamLabel,
  startOpen = false,
}: {
  facts: BracketFacts;
  /** Who is pressing: the athlete for their own team, or staff helping them. */
  mode: "athlete" | "staff";
  /** "#7 FALCONS" — said back to staff before they save. */
  teamLabel?: string;
  /** Opened from a list by its own button: show the form at once, not a second button. */
  startOpen?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(startOpen);
  const [category, setCategory] = useState(facts.category);
  const [division, setDivision] = useState(facts.division);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [done, setDone] = useState("");

  const staff = mode === "staff";
  const closed = staff ? CLOSED_STAFF : CLOSED_ATHLETE;
  const when = facts.closesAtLabel ?? "";
  const bracket = (one: string, level: string) => `${t(one)} · ${t(level)}`;

  if (facts.closed) {
    return (
      <p className="field-note" style={{ margin: "8px 0 0" }} data-testid="bracket-closed">
        {t(closed[facts.closed], { when })}
      </p>
    );
  }

  const levels = levelChoices(facts);
  const blocked = Object.values(facts.blockedCategories);
  const proLocked = !facts.proAllowed;
  const changed = category !== facts.category || division !== facts.division;
  const canSave = changed && !pending && !stale && (!staff || approved);

  function open() {
    setCategory(facts.category);
    setDivision(facts.division);
    setApproved(false);
    setError("");
    setStale(false);
    setDone("");
    setEditing(true);
  }

  function save() {
    setError("");
    const input = { teamId: facts.teamId, category, division, expectedCategory: facts.category, expectedDivision: facts.division };
    startTransition(async () => {
      try {
        const result = staff ? await assistBracketChange({ ...input, athleteApproved: approved }) : await changeMyBracket(input);
        if (!result.ok) {
          if (result.error === "STALE_BRACKET") setStale(true);
          setError(t(ERRORS[result.error] ?? closed[result.error] ?? "Something went wrong. Try again.", { when }));
          return;
        }
        setEditing(false);
        setDone(t("Saved. The team is now {bracket}.", { bracket: bracket(result.category, result.division) }));
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  if (!editing) {
    return (
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {done ? (
          <div className="notice" role="status">
            {done}
          </div>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <button type="button" className="btn btn-secondary" onClick={open}>
            {t("Change category or level")}
          </button>
          <span className="field-note" style={{ margin: 0 }}>
            {!staff
              ? t("You can change it yourself until {when} (Qatar time). After that, ask BFT MENA at the desk.", { when })
              : facts.side === "floor"
                ? t("Only at the athlete's request. Open until a score is entered for the team.")
                : t("Only at the athlete's request. Open until {when} (Qatar time); after that, BFT MENA changes it.", { when })}
          </span>
        </div>
      </div>
    );
  }

  return (
    <form
      className="card bracket-change"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) save();
      }}
    >
      <strong>
        {t("Change category or level")}
        {teamLabel ? ` — ${teamLabel}` : ""}
      </strong>

      <div>
        <span className="field-label">{t("Category")}</span>
        <div className="seg seg-lg bracket-seg" role="group" aria-label={t("Category")}>
          {CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
              data-active={category === value || undefined}
              aria-pressed={category === value}
              disabled={pending || Boolean(facts.blockedCategories[value])}
              onClick={() => setCategory(value)}
            >
              {t(value)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="field-label">{t("Level")}</span>
        <div className="seg seg-lg bracket-seg" role="group" aria-label={t("Level")}>
          {levels.map((level) => (
            <button
              key={level.value}
              type="button"
              data-active={division === level.value || undefined}
              aria-pressed={division === level.value}
              disabled={pending || !level.allowed}
              onClick={() => setDivision(level.value)}
            >
              {t(level.value)}
            </button>
          ))}
        </div>
      </div>

      {/* Why something is not on offer — said, not just greyed out. */}
      {blocked.length || proLocked ? (
        <ul className="field-note bracket-notes">
          {blocked.map((reason) => (
            <li key={reason}>{t(BLOCKED[reason])}</li>
          ))}
          {proLocked ? <li>{t("Moving into or out of Pro is done by BFT MENA.")}</li> : null}
        </ul>
      ) : null}

      {/* What this does, and what it leaves alone, before it is done. */}
      <div className="notice" role="status" data-testid="bracket-summary">
        {changed ? (
          <>
            <strong>
              {bracket(facts.category, facts.division)} → {bracket(category, division)}
            </strong>
            <p style={{ margin: "6px 0 0" }}>
              {t("The team will be listed and ranked with the {bracket} teams.", { bracket: bracket(category, division) })}{" "}
              {t("Its team number, wave, station, payment and check-in stay as they are.")}
            </p>
          </>
        ) : (
          t("Now: {bracket}. Choose a different category or level.", { bracket: bracket(facts.category, facts.division) })
        )}
      </div>

      {staff ? (
        <label className="bracket-approval">
          <input type="checkbox" checked={approved} disabled={pending} onChange={(event) => setApproved(event.target.checked)} />
          <span>
            <strong>{t("The athlete asked for this change and approves it.")}</strong>
            <span className="field-note" style={{ display: "block", margin: "2px 0 0" }}>
              {t("Your name, the time and the old and new values are recorded with this change.")}
            </span>
          </span>
        </label>
      ) : null}

      {error ? (
        <div className="notice-error" role="alert">
          {error}
          {stale ? (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
                {t("Reload")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={!canSave}>
          {pending ? <span className="spinner" /> : null}
          {t("Save change")}
        </button>
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setEditing(false)}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}
