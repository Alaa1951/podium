"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { changeMyTeam, type MembershipActionResult } from "@/lib/actions/membership";

// ─────────────────────────────────────────────────────────────────────────────
// CHANGING WHO IS ON THE TEAM — the athlete's side (release R2b).
//
// The registrant replaces their partner or fills the empty seat; the other
// member leaves. Every change says, before it is confirmed, who it affects
// and what stays as it is. The server decides everything again
// (membership-change.ts); this page only asks, and says honestly what came
// back.
//
// Sending twice is safe: a request carries one operation id for as long as
// its content is the same — a retry after a lost answer is recognised, not
// repeated. Changing the content makes it a new request.
// ─────────────────────────────────────────────────────────────────────────────

type Seat = { id: string; fullName: string; email: string | null; userId: string | null };

export type MembershipPanelProps = {
  teamId: string;
  version: number;
  role: "registrant" | "member" | "none";
  reason: null | "NOT_ON_TEAM" | "OWNERSHIP_UNKNOWN" | "JOINT_TEAM" | "REGISTRANT_UNRESOLVED";
  door: { open: true } | { open: false; reason: "NOT_FOUND" | "SERIES_FINISHED" | "TEAM_ALREADY_SCORED" | "WAVE_STARTED" | "TEAM_EDIT_CLOSED" };
  /** The seat the registrant may replace, as shown on this page. */
  partner: Seat | null;
  canFill: boolean;
  canLeave: boolean;
  mySeatId: string | null;
  /** Leaving waits for the incomplete-team policy (decision D3b). */
  leaveAvailable: boolean;
  teamLabel: string;
  registrantName: string | null;
  /** When changes close, already formatted in Qatar time. */
  closesAt: string;
};

const CLOSED: Record<string, string> = {
  TEAM_EDIT_CLOSED: "Team changes are closed — the event starts in less than 24 hours.",
  WAVE_STARTED: "Your wave has started, so the team cannot change now.",
  TEAM_ALREADY_SCORED: "Your team has a score, so it cannot change now.",
  SERIES_FINISHED: "This competition is finished.",
  NOT_FOUND: "This team is no longer entered.",
};

const NOBODY: Record<string, string> = {
  OWNERSHIP_UNKNOWN: "BFT MENA has not confirmed who registered this team yet. Until then, changes to the team go through them.",
  REGISTRANT_UNRESOLVED: "BFT MENA has not confirmed who registered this team yet. Until then, changes to the team go through them.",
  JOINT_TEAM: "You both registered separately, so neither of you can change the other's place. Changes to this team go through BFT MENA.",
};

const ERRORS: Record<string, string> = {
  STALE_MEMBERSHIP: "Your team changed while this page was open. Reload to see who is on it now.",
  OPERATION_MISMATCH: "This page sent something different under the same request. Reload and try again.",
  NAME_REQUIRED: "Type your partner's full name.",
  EMAIL_INVALID: "That email does not look right.",
  PARTNER_IS_YOU: "That is your own email. Type your partner's.",
  ALREADY_ENTERED: "That person is already entered in this competition.",
  LEAVE_NOT_AVAILABLE: "Leaving a team is not open yet. Ask BFT MENA.",
  NOT_ALLOWED: "You cannot make this change.",
  NOT_ON_TEAM: "You are no longer on this team.",
  FORBIDDEN: "You cannot make this change.",
  CHANGES_OFF: "Team changes are not open yet.",
  INVALID_INPUT: "Check the fields and try again.",
  ...CLOSED,
  ...NOBODY,
};

type Mode = "idle" | "replace" | "fill" | "leave";

export function MembershipActions(props: MembershipPanelProps) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("idle");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [done, setDone] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null);

  if (props.role === "none") {
    return props.reason && NOBODY[props.reason] ? <p className="field-note" style={{ marginTop: 10 }}>{t(NOBODY[props.reason])}</p> : null;
  }
  if (!props.door.open) {
    return (
      <p className="field-note" style={{ marginTop: 10 }}>
        {props.door.reason === "TEAM_EDIT_CLOSED"
          ? t("Team changes closed on {when} (Qatar time). Any change now goes through BFT MENA.", { when: props.closesAt })
          : t(CLOSED[props.door.reason])}
      </p>
    );
  }

  function open(next: Mode) {
    setMode(next);
    setError("");
    setStale(false);
    setDone("");
    setFullName("");
    setEmail("");
    request.current = null;
  }

  /** One id per distinct request: the same content again is the same request. */
  function operationIdFor(content: object) {
    const key = JSON.stringify(content);
    if (!request.current || request.current.key !== key) request.current = { key, id: crypto.randomUUID() };
    return request.current.id;
  }

  function send() {
    setError("");
    const base = { teamId: props.teamId, expectedVersion: props.version };
    const content =
      mode === "replace"
        ? { kind: "replace" as const, ...base, targetSeatId: props.partner!.id, expected: { userId: props.partner!.userId, email: props.partner!.email }, fullName, email }
        : mode === "fill"
          ? { kind: "fill" as const, ...base, fullName, email }
          : { kind: "leave" as const, ...base, mySeatId: props.mySeatId! };
    const operationId = operationIdFor(content);
    startTransition(async () => {
      let result: MembershipActionResult;
      try {
        result = await changeMyTeam({ ...content, operationId });
      } catch {
        // The answer was lost, not necessarily the change: the same request
        // (same id) can be sent again and will not be done twice.
        setError(t("No answer from the server. Check your connection and try again — it will not be done twice."));
        return;
      }
      if (!result.ok) {
        if (result.error === "STALE_MEMBERSHIP") setStale(true);
        setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
        return;
      }
      setMode("idle");
      setDone(
        result.code === "LEFT" ? t("You have left the team.")
          : result.code === "FILLED" ? t("Your partner has been added. They can sign in with a code sent to their email.")
            : result.code === "NO_CHANGE" ? t("Nothing to change — that is already your partner.")
              : t("Your partner has been replaced. The new partner can sign in with a code sent to their email.")
      );
      router.refresh();
    });
  }

  const newName = fullName.trim() || t("your new partner");
  const newEmail = email.trim() || t("their email");

  return (
    <div style={{ margin: "12px 0 16px", display: "grid", gap: 10 }}>
      {done ? <div className="notice" role="status">{done}</div> : null}

      {mode === "idle" ? (
        <>
        <p className="field-note" style={{ margin: 0 }}>
          {t("Team changes close on {when} (Qatar time). After that, BFT MENA makes them.", { when: props.closesAt })}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {props.role === "registrant" && props.partner ? (
            <button type="button" className="btn btn-secondary" onClick={() => open("replace")}>{t("Replace my partner")}</button>
          ) : null}
          {props.role === "registrant" && props.canFill ? (
            <button type="button" className="btn btn-primary" onClick={() => open("fill")}>{t("Add a partner")}</button>
          ) : null}
          {props.role === "member" && props.canLeave ? (
            props.leaveAvailable ? (
              <button type="button" className="btn btn-secondary" onClick={() => open("leave")}>{t("Leave the team")}</button>
            ) : (
              <p className="field-note" style={{ margin: 0 }}>{t("To leave this team, ask BFT MENA.")}</p>
            )
          ) : null}
        </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending) send();
          }}
          className="card"
          style={{ display: "grid", gap: 10, padding: 14 }}
        >
          <strong>
            {mode === "replace" ? t("Replace my partner") : mode === "fill" ? t("Add a partner") : t("Leave the team")}
          </strong>

          {mode !== "leave" ? (
            <>
              <label className="field-label">
                {t("Partner's full name")}
                <input className="input" value={fullName} maxLength={120} autoComplete="off" disabled={pending} onChange={(event) => setFullName(event.target.value)} required minLength={2} />
              </label>
              <label className="field-label">
                {t("Partner's email")}
                <input className="input" type="email" dir="ltr" value={email} maxLength={200} autoComplete="off" disabled={pending} onChange={(event) => setEmail(event.target.value)} required />
              </label>
            </>
          ) : null}

          {/* Who this touches, said before it is done. */}
          <ul className="field-note" style={{ margin: 0, paddingInlineStart: 18, display: "grid", gap: 4 }}>
            {mode === "replace" && props.partner ? (
              <li>{t("{name} will be taken off the team. They keep their account and anything they paid.", { name: props.partner.fullName })}</li>
            ) : null}
            {mode !== "leave" ? (
              <li>{t("{name} will be added, and can sign in with a code sent to {email} — no password needed.", { name: newName, email: `⁨${newEmail}⁩` })}</li>
            ) : null}
            {mode !== "leave" ? <li>{t("Your registration, payment, team number and wave stay as they are.")}</li> : null}
            {mode === "leave" ? (
              <>
                <li>{t("You will be taken off {team}.", { team: props.teamLabel })}</li>
                <li>{t("{name} keeps the team and its place.", { name: props.registrantName ?? t("The person who registered") })}</li>
                <li>{t("Your account and anything you paid stay as they are, and you can join another team.")}</li>
              </>
            ) : null}
          </ul>

          {error ? (
            <div className="notice-error" role="alert">
              {error}
              {stale ? (
                <div style={{ marginTop: 8 }}>
                  {/* A full reload, not a background refresh: nothing can be sent again
                      until the page shows the team as it is now. */}
                  <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>{t("Reload")}</button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="submit" className={mode === "leave" ? "btn btn-danger" : "btn btn-primary"} disabled={pending || stale}>
              {pending ? <span className="spinner" /> : null}
              {mode === "replace" ? t("Replace partner") : mode === "fill" ? t("Add partner") : t("Leave the team")}
            </button>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setMode("idle")}>{t("Cancel")}</button>
          </div>
        </form>
      )}
    </div>
  );
}
