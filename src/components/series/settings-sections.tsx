"use client";

import { useT } from "@/components/i18n/locale-provider";

import type { SeriesSettings } from "@/components/series/settings-form";

// The two sections of the settings screen that are only checkboxes and a
// number: what athletes and studios may change, and what the board shows.
// Lifted out so the form itself stays readable in one sitting. Scores are
// entered by judges only, so there is no studio score-entry switch here.

export type Setter = <K extends keyof SeriesSettings>(key: K, value: SeriesSettings[K]) => void;

export function StudioPermissions({ form, set }: { form: SeriesSettings; set: Setter }) {
  const t = useT();

  return (
    <section className="form-block">
      <h2 className="section-title">{t("Team changes")}</h2>
      <div className="form-row">
        <Field
          label={t("Team changes close (hours before the event)")}
          hint={t("A member may correct names and emails on their team until this many hours before the competition. 0 closes at the start time itself.")}
        >
          <input
            className="input pd-num"
            type="number"
            min={0}
            max={720}
            value={form.teamEditCloseHours}
            onChange={(e) => set("teamEditCloseHours", Number(e.target.value) || 0)}
          />
        </Field>
      </div>
    </section>
  );
}

export function BoardDisplay({ form, set }: { form: SeriesSettings; set: Setter }) {
  const t = useT();

  const lines: { key: keyof SeriesSettings; label: string }[] = [
    { key: "showTeamName", label: t("Team name") },
    { key: "showCompetitorNames", label: t("Athlete names") },
    { key: "showStudioColumn", label: t("Studio column") },
  ];

  return (
    <section className="form-block">
      <h2 className="section-title">{t("What the board shows")}</h2>
      <p className="reg-sub" style={{ marginTop: 4 }}>
        {t(
          "BFT International's board lists the two competitors; MENA may prefer the registered team name, or both."
        )}
      </p>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {lines.map((line) => (
          <label key={line.key} className="checkline">
            <input
              type="checkbox"
              checked={Boolean(form[line.key])}
              onChange={(e) => set(line.key, e.target.checked as SeriesSettings[typeof line.key])}
            />
            <span>{line.label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

/** A labelled control in a settings row. Shared by every section. */
export function Field({
  label,
  hint,
  grow = 1,
  children,
}: {
  label: string;
  hint?: string;
  grow?: number;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", flex: `${grow} 1 200px`, minWidth: 0 }}>
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
