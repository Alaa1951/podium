"use client";

import { useT } from "@/components/i18n/locale-provider";

import type { SeriesSettings } from "@/components/series/settings-form";

// The two sections of the settings screen that are only checkboxes and a
// number: what a studio may do, and what the board shows. Lifted out so the
// form itself stays readable in one sitting.

export type Setter = <K extends keyof SeriesSettings>(key: K, value: SeriesSettings[K]) => void;

export function StudioPermissions({ form, set }: { form: SeriesSettings; set: Setter }) {
  const t = useT();

  return (
    <section className="form-block">
      <h2 className="section-title">{t("What studios may do")}</h2>
      <label className="checkline" style={{ marginTop: 10 }}>
        <input
          type="checkbox"
          checked={form.studiosMayEnterScores}
          onChange={(e) => set("studiosMayEnterScores", e.target.checked)}
        />
        <span>{t("Studios may enter scores for their own teams")}</span>
      </label>
      <p className="reg-sub" style={{ marginTop: 8, maxWidth: "68ch" }}>
        {t(
          "Entering is not the same as changing. The BFT manual is explicit that a saved score is final: a studio that records a result cannot edit it, and every correction comes from BFT MENA."
        )}
      </p>

      <div className="form-row">
        <Field
          label={t("Further writes allowed")}
          hint={t("0 means a saved score locks immediately")}
        >
          <input
            className="input pd-num"
            type="number"
            min={0}
            max={5}
            value={form.studioScoreCorrections}
            onChange={(e) => set("studioScoreCorrections", Number(e.target.value) || 0)}
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
    { key: "showCompetitorNames", label: t("Competitor names") },
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
