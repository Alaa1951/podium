"use client";

import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { updateRegistration } from "@/lib/actions/registrations";
import { CATEGORIES } from "@/lib/scoring";

import type { StudioTeamRow } from "@/components/studio/studio-teams-table";
import { confirmUnsaved, useUnsavedChanges } from "@/components/app/mobile-runtime";

// ─────────────────────────────────────────────────────────────────────────────
// CORRECTING AN ENTRY.
//
// A studio may fix the team name, the two people and the category. The division
// is SHOWN — it is part of the entry and hiding it would be confusing — but it
// is not a field: per the manual's FAQ, a change of division goes to BFT MENA,
// because it decides who the pair is ranked against.
//
// The server refuses a division change from a studio whatever this form sends;
// the disabled control is the explanation, not the enforcement.
// ─────────────────────────────────────────────────────────────────────────────

export function StudioTeamEditor({
  row,
  studios,
  onDone,
  canChooseDivision = false,
  canCorrectIdentity = false,
}: {
  row: StudioTeamRow;
  studios: { id: string; name: string }[];
  onDone: () => void;
  canChooseDivision?: boolean;
  /** BFT MENA Full access: an email here corrects the same athlete (staff-membership.ts). */
  canCorrectIdentity?: boolean;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [name, setName] = useState(row.name);
  const [category, setCategory] = useState(row.category);
  const [division, setDivision] = useState(row.division);
  const [saved, setSaved] = useState(false);
  const [people, setPeople] = useState(row.people);
  const [confirmAccount, setConfirmAccount] = useState(false);
  // A signed-in athlete's email is the one they sign in with: changing it is said out loud.
  const accountEmailChanged = canCorrectIdentity && people.some((p, index) => row.people[index]?.linked && sameEmail(p.email) !== sameEmail(row.people[index].email));
  useUnsavedChanges(!saved && (name !== row.name || category !== row.category || division !== row.division || JSON.stringify(people) !== JSON.stringify(row.people)));

  function person(index: number, patch: Partial<StudioTeamRow["people"][number]>) {
    setPeople((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function save() {
    setError("");
    startTransition(async () => {
      try {
        const result = await updateRegistration({
          teamId: row.id,
          teamName: name,
          category,
          division,
          one: toPerson(people[0]),
          // A team may have one seat (a partner not named yet): no second
          // person is sent, and the server creates one only when added here.
          ...(people[1] ? { two: toPerson(people[1]) } : {}),
          ...(row.version !== undefined ? { expectedVersion: row.version } : {}),
          ...(accountEmailChanged && confirmAccount ? { confirmAccountEmail: true } : {}),
        });

        if (!result.ok) {
          setError(
            result.error === "DIVISION_LOCKED"
              ? t("To change the level at the athlete's request, use Category / level on the team.")
              : result.error === "REGISTRATION_CLOSED"
                ? t("Registrations have closed. Ask BFT MENA for any further change.")
                : result.error === "REGISTRANT_EMAIL_LOCKED"
                  ? t("The email of the person who registered the team is changed by BFT MENA.")
                  : result.error === "PERSON_CHANGED"
                    ? t("A new name and a new email is a different person. Use Swap on that person's page to put someone else in the team.")
                    : result.error === "CONFIRM_ACCOUNT_EMAIL"
                      ? t("Tick the box to confirm the athlete's sign-in email changes.")
                    : result.error === "ACCOUNT_EMAIL_TAKEN"
                      ? t("Another PODIUM account already uses that email. To put that account in the team, use Swap on the athlete's page.")
                    : result.error === "OWN_ACCOUNT"
                      ? t("You cannot change your own sign-in email here. Another Full access account can.")
                    : result.error === "EMAIL_INVALID"
                      ? t("Check the fields — a name is missing or an email is not valid.")
                    : result.error === "LINKED_SEAT_EMAIL"
                      ? t("This person signs in with that email. Change it on their account (Users), or use Swap to put someone else in the team.")
                      : result.error === "TEAM_EDIT_CLOSED"
                        ? row.closesAt
                          ? t("Team changes closed on {when} (Qatar time). Only BFT MENA Full access can change the team now.", { when: row.closesAt })
                          : t("Team changes are closed. Only BFT MENA Full access can change the team now.")
                        : result.error === "WAVE_STARTED"
                          ? t("This team's wave has started. Who is on it cannot change now.")
                          : result.error === "TEAM_ALREADY_SCORED"
                            ? t("This team has a score. Who is on it cannot change now.")
                            : result.error === "SERIES_FINISHED"
                              ? t("This competition is finished.")
                      : result.error === "STALE_MEMBERSHIP"
                        ? t("This team changed while the form was open. Reload to see it as it is now.")
                        : result.error === "ALREADY_ENTERED"
                          ? t("That person is already entered in this competition.")
                : result.error === "INVALID_INPUT"
                  ? t("Check the fields — a name is missing or an email is not valid.")
                  : t("Something went wrong. Try again.")
          );
          return;
        }
        setSaved(true);
        onDone();
      } catch { setError(t("Could not save. Check your connection and try again.")); }
    });
  }

  return (
    <div className="studio-editor">
      {row.closed ? (
        <div className="notice" role="status" style={{ marginTop: 0, marginBottom: 12 }}>
          {row.closesAt
            ? t("Team changes closed on {when} (Qatar time). Only BFT MENA Full access can change the team now.", { when: row.closesAt })
            : t("Team changes are closed. Only BFT MENA Full access can change the team now.")}
        </div>
      ) : row.closesAt ? (
        <p className="field-note" style={{ marginTop: 0 }}>
          {t("Team changes close on {when} (Qatar time). After that, only BFT MENA Full access can change the team.", { when: row.closesAt })}
        </p>
      ) : null}
      {canCorrectIdentity ? (
        <p className="field-note" style={{ marginTop: 0 }}>
          {t("Correcting a name or an email keeps the same athlete — their account, waiver and check-in stay. To put someone else in the team, use Swap on the athlete's page.")}
        </p>
      ) : null}
      <div className="form-grid">
        <label>
          <span className="field-label">{t("Team name")}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label>
          <span className="field-label">{t("Category")}</span>
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {t(option)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="field-label">{t("Division")}</span>
          {canChooseDivision ? <select className="input" value={division} onChange={event=>setDivision(event.target.value)}>{["Rookie","Open","Pro"].map(value=><option key={value} value={value}>{t(value)}</option>)}</select> : <><input className="input" value={t(row.division)} disabled readOnly /><span className="field-note">{t("To change the level at the athlete's request, use Category / level on the team.")}</span></>}
        </label>
      </div>

      {people.map((p, index) => (
        <div key={index} className="studio-editor-person">
          <div className="console-group-title">
            {t("Athlete")} {index + 1}
          </div>
          <div className="form-grid">
            <label>
              <span className="field-label">{t("Full name")}</span>
              <input
                className="input"
                value={p.fullName}
                onChange={(e) => person(index, { fullName: e.target.value })}
              />
            </label>
            <label>
              <span className="field-label">{t("Email")}</span>
              <input
                className="input"
                type="email"
                value={p.email ?? ""}
                onChange={(e) => person(index, { email: e.target.value })}
              />
              {canCorrectIdentity && p.linked ? (
                <span className="field-note" data-testid="account-email-note">{t("Has a PODIUM account: a corrected email becomes the one they sign in with.")}</span>
              ) : null}
            </label>
            <label>
              <span className="field-label">{t("Phone")}</span>
              <input
                className="input pd-num"
                value={p.phone ?? ""}
                onChange={(e) => person(index, { phone: e.target.value })}
              />
            </label>
            <label>
              <span className="field-label">{t("Date of birth")}</span>
              <input
                className="input"
                type="date"
                value={p.dateOfBirth}
                onChange={(e) => person(index, { dateOfBirth: e.target.value })}
              />
            </label>
            <label>
              <span className="field-label">{t("BFT membership")}</span>
              <select
                className="input"
                value={p.studioId ?? ""}
                onChange={(e) => person(index, { studioId: e.target.value || null })}
              >
                <option value="">{t("Not a member")}</option>
                {studios.map((studio) => (
                  <option key={studio.id} value={studio.id}>
                    {studio.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ))}

      {people.length < 2 ? (
        <div className="notice" style={{ marginTop: 12 }}>
          <strong>{t("Partner needed")}</strong>
          <p style={{ margin: "6px 0 10px" }}>{t("This team has one athlete. Add the partner here when they are known.")}</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPeople((current) => [...current, { fullName: "", email: "", phone: "", dateOfBirth: "", studioId: null }])}
          >
            {t("Add partner")}
          </button>
        </div>
      ) : null}

      {accountEmailChanged ? (
        <label className="checkline" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12 }}>
          <input type="checkbox" checked={confirmAccount} onChange={(e) => setConfirmAccount(e.target.checked)} data-testid="confirm-account-email" />
          <span>{t("Same athlete: I confirm their sign-in email changes to the new one. Codes and links sent to the old email stop working.")}</span>
        </label>
      ) : null}

      {error ? (
        <div className="notice-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}

      <div className="mobile-action-bar" style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button type="button" className="btn btn-primary" disabled={pending || Boolean(row.closed) || (accountEmailChanged && !confirmAccount)} onClick={save}>
          {pending ? <span className="spinner" /> : null}
          {t("Save changes")}
        </button>
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={()=>{if(confirmUnsaved(t("You have unsaved changes. Leave this screen?")))onDone();}}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

const sameEmail = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();

/** The shape the registration action's person schema expects. */
const toPerson = (p: StudioTeamRow["people"][number]) => ({
  ...(p.id ? { id: p.id } : {}),
  fullName: p.fullName,
  email: p.email ?? "",
  phone: p.phone ?? "",
  dateOfBirth: p.dateOfBirth,
  studioId: p.studioId,
});
