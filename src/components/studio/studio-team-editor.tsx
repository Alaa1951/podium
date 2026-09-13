"use client";

import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { updateRegistration } from "@/lib/actions/registrations";
import { CATEGORIES } from "@/lib/scoring";

import type { StudioTeamRow } from "@/components/studio/studio-teams-table";

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
}: {
  row: StudioTeamRow;
  studios: { id: string; name: string }[];
  onDone: () => void;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [name, setName] = useState(row.name);
  const [category, setCategory] = useState(row.category);
  const [people, setPeople] = useState(row.people);

  function person(index: number, patch: Partial<StudioTeamRow["people"][number]>) {
    setPeople((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function save() {
    setError("");
    startTransition(async () => {
      const result = await updateRegistration({
        teamId: row.id,
        teamName: name,
        category,
        division: row.division,
        one: toPerson(people[0]),
        two: toPerson(people[1]),
      });

      if (!result.ok) {
        setError(
          result.error === "DIVISION_LOCKED"
            ? t("A change of division comes from BFT MENA.")
            : result.error === "REGISTRATION_CLOSED"
              ? t("Registrations have closed. Ask BFT MENA for any further change.")
              : result.error === "INVALID_INPUT"
                ? t("Check the fields — a name is missing or an email is not valid.")
                : t("Something went wrong. Try again.")
        );
        return;
      }
      onDone();
    });
  }

  return (
    <div className="studio-editor">
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
          <input className="input" value={t(row.division)} disabled readOnly />
          <span className="field-note">{t("A change of division comes from BFT MENA.")}</span>
        </label>
      </div>

      {people.map((p, index) => (
        <div key={index} className="studio-editor-person">
          <div className="console-group-title">
            {t("Competitor")} {index + 1}
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

      {error ? (
        <div className="notice-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
          {pending ? <span className="spinner" /> : null}
          {t("Save changes")}
        </button>
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={onDone}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

/** The shape the registration action's person schema expects. */
const toPerson = (p: StudioTeamRow["people"][number]) => ({
  fullName: p.fullName,
  email: p.email ?? "",
  phone: p.phone ?? "",
  dateOfBirth: p.dateOfBirth,
  studioId: p.studioId,
});
