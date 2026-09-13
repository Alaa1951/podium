"use client";

import { useT } from "@/components/i18n/locale-provider";
import type { Person } from "@/components/admin/registration-form";

// One competitor's block of the registration form, and the labelled field it
// is built from.

export function PersonBlock({
  title,
  note,
  person,
  onChange,
  studios,
}: {
  title: string;
  note: string;
  person: Person;
  onChange: (next: Person) => void;
  studios: { id: string; name: string }[];
}) {
  const t = useT();
  const set = (key: keyof Person) => (value: string) => onChange({ ...person, [key]: value });

  return (
    <section className="form-block">
      <h2 className="section-title">{title}</h2>
      <p className="reg-sub" style={{ marginTop: 4 }}>
        {note}
      </p>

      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label={t("Full name")}>
          <input
            className="input"
            value={person.fullName}
            onChange={(e) => set("fullName")(e.target.value)}
            required
          />
        </Field>
        <Field label={t("Phone")}>
          <input
            className="input pd-num"
            value={person.phone}
            onChange={(e) => set("phone")(e.target.value)}
            inputMode="tel"
          />
        </Field>
      </div>

      <div className="form-row">
        <Field label={t("Email")}>
          <input
            className="input"
            type="email"
            value={person.email}
            onChange={(e) => set("email")(e.target.value)}
          />
        </Field>
        <Field label={t("Date of birth")}>
          <input
            className="input pd-num"
            type="date"
            value={person.dateOfBirth}
            onChange={(e) => set("dateOfBirth")(e.target.value)}
          />
        </Field>
      </div>

      <div className="form-row">
        <Field
          label={t("BFT studio membership")}
          hint={t("A competitor may be a member of no studio at all.")}
        >
          <select
            className="input"
            value={person.studioId}
            onChange={(e) => set("studioId")(e.target.value)}
          >
            <option value="">{t("Not a member")}</option>
            {studios.map((studio) => (
              <option key={studio.id} value={studio.id}>
                {studio.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", flex: "1 1 220px", minWidth: 0 }}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? (
        <span className="reg-sub" style={{ display: "block" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}
