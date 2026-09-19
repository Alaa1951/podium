"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { savePartner } from "@/lib/actions/partner";

// ─────────────────────────────────────────────────────────────────────────────
// AN ATHLETE'S PROFILE — level, category and partner.
//
// A linked partner is shown and fixed. Otherwise the athlete can name one or
// say they are looking; naming someone links the two only when that person
// names them back (or was looking for a partner themselves).
// ─────────────────────────────────────────────────────────────────────────────

export type AthleteProfileDTO = {
  division: string | null;
  category: string | null;
  lookingForPartner: boolean;
  partnerName: string | null;
  partnerEmail: string | null;
  partnerPhone: string | null;
  partnerLinked: boolean;
};

const ERRORS: Record<string, string> = {
  PARTNER_REQUIRED: "Enter your partner's name and email.",
  PARTNER_EMAIL_INVALID: "That partner email does not look right.",
  PARTNER_IS_YOU: "Your partner needs their own email.",
  ALREADY_LINKED: "You are already linked to a partner.",
  FORBIDDEN: "You cannot change this yet.",
};

const DIVISIONS = ["Rookie", "Open", "Pro"] as const;
const CATEGORIES = ["Womens", "Mens", "Mixed"] as const;

export function AthleteProfile({ profile, canEdit }: { profile: AthleteProfileDTO; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    division: profile.division ?? "Rookie",
    category: profile.category ?? "Mixed",
    hasPartner: !profile.lookingForPartner && Boolean(profile.partnerEmail),
    partnerName: profile.partnerName ?? "",
    partnerEmail: profile.partnerEmail ?? "",
    partnerPhone: profile.partnerPhone ?? "",
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  function save() {
    setError("");
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await savePartner(form);
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
          return;
        }
        setSaved(true);
        setEditing(false);
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  const partnerLine = profile.partnerLinked
    ? t("{name} — linked", { name: profile.partnerName ?? profile.partnerEmail ?? "" })
    : profile.partnerEmail
      ? t("{name} — waiting for them to name you back", { name: profile.partnerName ?? profile.partnerEmail })
      : t("Looking for a partner");

  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>{t("Your athlete profile")}</h2>
        {canEdit && !profile.partnerLinked && !editing ? (
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
            {t("Change")}
          </button>
        ) : null}
      </div>

      {!editing ? (
        <dl className="approval-facts">
          <dt>{t("Level")}</dt>
          <dd>{profile.division ? t(profile.division) : "—"}</dd>
          <dt>{t("Category")}</dt>
          <dd>{profile.category ? t(profile.category) : "—"}</dd>
          <dt>{t("Partner")}</dt>
          <dd>{partnerLine}</dd>
        </dl>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="form-row">
            <label style={{ flex: "1 1 160px" }}>
              <span className="field-label">{t("Level")}</span>
              <select className="input" value={form.division} disabled={pending} onChange={(e) => set("division", e.target.value)}>
                {DIVISIONS.map((value) => (
                  <option key={value} value={value}>
                    {t(value)}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ flex: "1 1 160px" }}>
              <span className="field-label">{t("Category")}</span>
              <select className="input" value={form.category} disabled={pending} onChange={(e) => set("category", e.target.value)}>
                {CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {t(value)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="seg seg-lg" role="group" style={{ margin: "12px 0" }}>
            <button type="button" data-active={form.hasPartner || undefined} disabled={pending} onClick={() => set("hasPartner", true)}>
              {t("I have a partner")}
            </button>
            <button type="button" data-active={!form.hasPartner || undefined} disabled={pending} onClick={() => set("hasPartner", false)}>
              {t("Looking for a partner")}
            </button>
          </div>
          {form.hasPartner ? (
            <div className="form-row">
              <label style={{ flex: "1 1 200px" }}>
                <span className="field-label">{t("Partner's name")}</span>
                <input className="input" value={form.partnerName} maxLength={120} disabled={pending} onChange={(e) => set("partnerName", e.target.value)} />
              </label>
              <label style={{ flex: "1 1 200px" }}>
                <span className="field-label">{t("Partner's email")}</span>
                <input className="input" type="email" value={form.partnerEmail} maxLength={200} disabled={pending} onChange={(e) => set("partnerEmail", e.target.value)} />
              </label>
              <label style={{ flex: "1 1 160px" }}>
                <span className="field-label">{t("Partner's phone")}</span>
                <input className="input" type="tel" value={form.partnerPhone} maxLength={30} disabled={pending} onChange={(e) => set("partnerPhone", e.target.value)} />
              </label>
            </div>
          ) : (
            <p className="reg-sub">{t("Your studio sees you as looking for a partner at your level and category.")}</p>
          )}
          {error ? (
            <div className="notice-error" role="alert" style={{ marginTop: 10 }}>
              {error}
            </div>
          ) : null}
          <div className="approval-actions">
            <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
              {t("Save")}
            </button>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setEditing(false)}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
      {saved ? <p className="reg-sub" role="status">{t("Saved.")}</p> : null}
    </section>
  );
}
