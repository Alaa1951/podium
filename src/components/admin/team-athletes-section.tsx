"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { correctTeamAthlete } from "@/lib/actions/team-athletes";
import { swapTeamMember } from "@/lib/actions/team-swap";
import type { AthleteFacts, TeamAthletes } from "@/lib/team-athletes";

// ─────────────────────────────────────────────────────────────────────────────
// THE ATHLETES OF A TEAM, EACH WITH AN EDIT BUTTON — on the team's page, for
// BFT MENA, the organiser and the team's own gym.
//
// Two different acts, never confused: CORRECT this athlete (the same person —
// a name, an email, a phone, a date of birth put right) or REPLACE them with
// somebody else (a swap: the team keeps its number, wave and station). After
// team changes close, anybody but Full access makes either only at the
// athlete's request, on the tick the category and level change uses. What
// cannot be done is SAID on the panel; the server decides it all again.
// ─────────────────────────────────────────────────────────────────────────────

const ERRORS: Record<string, string> = {
  TEAM_EDIT_CLOSED: "Team changes are closed. Tick that the athlete asked for this change.",
  REGISTRATION_CLOSED: "Registrations have closed. Ask BFT MENA for any further change.",
  ACCOUNT_DETAILS: "This athlete signs in to PODIUM: their name, email and phone are their account's. They change them in their profile, or BFT MENA Full access does.",
  REGISTRANT_EMAIL_LOCKED: "The email of the person who registered the team is changed by BFT MENA.",
  CONFIRM_ACCOUNT_EMAIL: "Tick the box to confirm the athlete's sign-in email changes.",
  ACCOUNT_EMAIL_TAKEN: "Another PODIUM account already uses that email. To put that account in the team, use Swap on the athlete's page.",
  OWN_ACCOUNT: "You cannot change your own sign-in email here. Another Full access account can.",
  ALREADY_ENTERED: "That person is already entered in this competition.",
  EMAIL_INVALID: "That email does not look right.",
  STALE_MEMBERSHIP: "This team changed while the page was open. Reload to see it as it is now.",
  SERIES_FINISHED: "This competition is finished. Its field is the record now.",
  TEAM_ALREADY_SCORED: "This team has a score. Nobody can be swapped out of a scored team.",
  WAVE_STARTED: "This team's wave has started. Nobody can be swapped once they are on the floor.",
  REGISTRANT_SEAT: "This person registered the team. Only BFT MENA can replace them.",
  TRANSFER_REQUIRED: "Confirm that the replacement will be the one who registered the team.",
  NAME_REQUIRED: "Choose an athlete or type the substitute's name.",
  INVALID_INPUT: "Check the fields — a name is missing or an email is not valid.",
  FORBIDDEN: "You cannot change this.",
};

export function TeamAthletesSection({ team }: { team: TeamAthletes }) {
  const t = useT();
  return (
    <section className="card" id="athletes" style={{ marginTop: 16 }} data-testid="team-athletes">
      <h2 className="section-title" style={{ margin: 0 }}>{t("Athletes")}</h2>
      {team.closed && !team.full ? (
        <p className="reg-sub" style={{ margin: "4px 0 0" }}>
          {t("Team changes closed on {when} (Qatar time). A change the athlete asks for can still be made here, on their request.", { when: team.closesAt })}
        </p>
      ) : null}
      {team.athletes.map((athlete) => (
        <AthleteRow key={athlete.id} team={team} athlete={athlete} />
      ))}
    </section>
  );
}

function AthleteRow({ team, athlete }: { team: TeamAthletes; athlete: AthleteFacts }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"correct" | "replace">("correct");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [asked, setAsked] = useState(false);
  const [confirmAccount, setConfirmAccount] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [form, setForm] = useState({ fullName: athlete.fullName, email: athlete.email ?? "", phone: athlete.phone ?? "", dateOfBirth: athlete.dateOfBirth });
  const [swap, setSwap] = useState({ fullName: "", email: "", phone: "" });

  // Whose details are whose: a signed-in athlete's name, email and phone are
  // their account's (Full access only); the registrant's email is BFT MENA's.
  const accountLocked = athlete.linked && !team.full;
  const emailLocked = accountLocked || (athlete.registrant && !team.bft);
  const accountEmailChanged = athlete.linked && team.full && form.email.trim().toLowerCase() !== (athlete.email ?? "").toLowerCase();
  const needsAsk = !team.full;
  const replaceBlocked = team.barrier ?? (athlete.registrant && !team.bft ? "REGISTRANT_SEAT" : null);

  function reset() {
    setError("");
    setAsked(false);
    setConfirmAccount(false);
    setTransfer(false);
    setForm({ fullName: athlete.fullName, email: athlete.email ?? "", phone: athlete.phone ?? "", dateOfBirth: athlete.dateOfBirth });
    setSwap({ fullName: "", email: "", phone: "" });
  }

  function save() {
    setError("");
    setDone("");
    startTransition(async () => {
      try {
        const result = mode === "correct"
          ? await correctTeamAthlete({
              competitorId: athlete.id, fullName: form.fullName, email: form.email, phone: form.phone, dateOfBirth: form.dateOfBirth,
              expectedVersion: team.version,
              ...(needsAsk && asked ? { assisted: true } : {}),
              ...(accountEmailChanged && confirmAccount ? { confirmAccountEmail: true } : {}),
            })
          : await swapTeamMember({
              competitorId: athlete.id, fullName: swap.fullName, email: swap.email, phone: swap.phone, expectedVersion: team.version,
              ...(athlete.registrant ? { transferOwnership: transfer } : {}),
              ...(needsAsk && asked ? { assisted: true } : {}),
            });
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
          return;
        }
        setDone(mode === "correct" ? t("Saved.") : t("Swapped. The team keeps its number, wave and station."));
        setOpen(false);
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  const blockedSave = pending || (needsAsk && !asked) || (mode === "correct" && accountEmailChanged && !confirmAccount)
    || (mode === "replace" && (Boolean(replaceBlocked) || !swap.fullName.trim()));

  return (
    <div className="athlete-row" data-testid={`athlete-${athlete.position}`} style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <strong>{athlete.position}. {athlete.fullName}</strong>
        <span className="reg-sub">{athlete.email ?? t("no email")}</span>
        <span className="reg-sub pd-num">{athlete.phone ?? t("no phone")}</span>
        {athlete.linked ? <span className="badge badge-neutral">{t("Has a PODIUM account")}</span> : null}
        {athlete.registrant ? <span className="badge badge-blue">{t("Registered the team")}</span> : null}
        {!open ? (
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginInlineStart: "auto" }} data-testid={`athlete-edit-${athlete.position}`} onClick={() => { reset(); setDone(""); setOpen(true); }}>
            {t("Edit")}
          </button>
        ) : null}
      </div>

      {open ? (
        <div style={{ marginTop: 12 }} data-testid="athlete-panel">
          {team.canReplace ? (
            <div className="seg seg-lg" role="group" style={{ marginBottom: 12 }}>
              <button type="button" data-active={mode === "correct" || undefined} disabled={pending} onClick={() => { setMode("correct"); setError(""); }}>
                {t("Correct details")}
              </button>
              <button type="button" data-active={mode === "replace" || undefined} disabled={pending} onClick={() => { setMode("replace"); setError(""); }} data-testid="athlete-replace">
                {t("Replace with another person")}
              </button>
            </div>
          ) : null}

          {mode === "correct" ? (
            <>
              <p className="reg-sub" style={{ marginTop: 0 }}>{t("The same athlete: their check-in, warm-up and waiver stay.")}</p>
              <div className="form-row">
                <label style={{ flex: "1 1 200px" }}>
                  <span className="field-label">{t("Full name")}</span>
                  <input className="input" value={form.fullName} maxLength={120} disabled={pending} readOnly={accountLocked} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
                </label>
                <label style={{ flex: "1 1 220px" }}>
                  <span className="field-label">{t("Email")}</span>
                  <input className="input" type="email" value={form.email} maxLength={200} disabled={pending} readOnly={emailLocked} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </label>
                <label style={{ flex: "1 1 160px" }}>
                  <span className="field-label">{t("Phone")}</span>
                  <input className="input pd-num" type="tel" value={form.phone} maxLength={30} disabled={pending} readOnly={accountLocked} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </label>
                <label style={{ flex: "1 1 160px" }}>
                  <span className="field-label">{t("Date of birth")}</span>
                  <input className="input" type="date" value={form.dateOfBirth} disabled={pending} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
                </label>
              </div>
              {accountLocked ? (
                <p className="field-note">{t(ERRORS.ACCOUNT_DETAILS)}</p>
              ) : athlete.registrant && !team.bft ? (
                <p className="field-note">{t(ERRORS.REGISTRANT_EMAIL_LOCKED)}</p>
              ) : null}
              {accountEmailChanged ? (
                <label className="checkline" style={{ marginTop: 10 }}>
                  <input type="checkbox" checked={confirmAccount} disabled={pending} onChange={(e) => setConfirmAccount(e.target.checked)} data-testid="athlete-confirm-account" />
                  <span>{t("Same athlete: I confirm their sign-in email changes to the new one. Codes and links sent to the old email stop working.")}</span>
                </label>
              ) : null}
            </>
          ) : replaceBlocked ? (
            <p className="notice" data-testid="athlete-replace-blocked">{t(ERRORS[replaceBlocked])}</p>
          ) : (
            <>
              <p className="reg-sub" style={{ marginTop: 0 }}>
                {t("Somebody else takes {name}'s place on this team. The team keeps its number, wave and station.", { name: athlete.fullName })}
              </p>
              <div className="form-row">
                <label style={{ flex: "1 1 200px" }}>
                  <span className="field-label">{t("Full name")}</span>
                  <input className="input" value={swap.fullName} maxLength={120} disabled={pending} onChange={(e) => setSwap({ ...swap, fullName: e.target.value })} data-testid="athlete-replace-name" />
                </label>
                <label style={{ flex: "1 1 220px" }}>
                  <span className="field-label">{t("Email (optional)")}</span>
                  <input className="input" type="email" value={swap.email} maxLength={200} disabled={pending} onChange={(e) => setSwap({ ...swap, email: e.target.value })} data-testid="athlete-replace-email" />
                </label>
                <label style={{ flex: "1 1 160px" }}>
                  <span className="field-label">{t("Phone (optional)")}</span>
                  <input className="input" type="tel" value={swap.phone} maxLength={30} disabled={pending} onChange={(e) => setSwap({ ...swap, phone: e.target.value })} />
                </label>
              </div>
              {athlete.registrant ? (
                <label className="checkline" style={{ marginTop: 10 }}>
                  <input type="checkbox" checked={transfer} disabled={pending} onChange={(e) => setTransfer(e.target.checked)} />
                  <span>{t("{name} registered this team. The replacement becomes the one who registered it, by their email.", { name: athlete.fullName })}</span>
                </label>
              ) : null}
            </>
          )}

          {needsAsk && !(mode === "replace" && replaceBlocked) ? (
            <label className="checkline" style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" checked={asked} disabled={pending} onChange={(e) => setAsked(e.target.checked)} data-testid="athlete-asked" />
              <span>
                <strong>{t("The athlete asked for this change and approves it.")}</strong>
                <br />
                <span className="reg-sub">{t("Your name, the time and the old and new values are recorded with this change.")}</span>
              </span>
            </label>
          ) : null}

          {error ? <div className="notice-error" role="alert" style={{ marginTop: 10 }}>{error}</div> : null}

          <div className="approval-actions">
            <button type="button" className="btn btn-primary" disabled={blockedSave} onClick={save} data-testid="athlete-save">
              {pending ? <span className="spinner" /> : null}
              {mode === "correct" ? t("Save change") : t("Swap them in")}
            </button>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => { setOpen(false); reset(); }}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {done ? <p className="reg-sub" role="status" data-testid="athlete-done">{done}</p> : null}
    </div>
  );
}
