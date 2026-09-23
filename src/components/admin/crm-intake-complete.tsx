"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useT } from "@/components/i18n/locale-provider";
import { completeCrmRegistration } from "@/lib/actions/crm-complete";

// ─────────────────────────────────────────────────────────────────────────────
// FILLING IN WHAT THE CRM FORM DID NOT.
//
// The form under a held registration. Category and Division are why almost
// every one of these rows exists — both are required in PODIUM and neither can
// be guessed, because Division decides the prescribed loads a pair lifts.
//
// IT WRITES TO THE CRM, NOT TO PODIUM. That is worth knowing while reading
// this, because it explains the wait: pressing Save does not create a team, it
// completes the CRM record and asks the sync to bring it in. The message that
// comes back says which of those happened.
//
// EVERY FIELD IS OPTIONAL HERE, and that is deliberate rather than lax. The
// action sends only what is filled in, so a half-known answer can be saved now
// and the rest later — and, more importantly, an empty box CANNOT wipe what the
// registrant typed into the CRM themselves.
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = ["Mens", "Womens", "Mixed"] as const;
const DIVISIONS = ["Rookie", "Open", "Pro"] as const;
const SHIRTS = ["XS", "S", "M", "L", "XL", "XXL"] as const;

export function CrmIntakeComplete({
  intakeId,
  seriesId,
  partnerName,
  teamName,
  studioNames,
  onDone,
}: {
  intakeId: string;
  seriesId: string;
  /** What the CRM already holds, so staff correct rather than retype. */
  partnerName: string | null;
  teamName: string | null;
  /** Studios as PODIUM spells them — the action maps them to the CRM's labels. */
  studioNames: string[];
  onDone: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  function save(form: FormData) {
    setMessage("");
    setFailed(false);
    startTransition(async () => {
      const value = (name: string) => String(form.get(name) ?? "").trim();
      const result = await completeCrmRegistration({
        intakeId,
        seriesId,
        category: (value("category") || null) as "Mens" | "Womens" | "Mixed" | null,
        division: (value("division") || null) as "Rookie" | "Open" | "Pro" | null,
        teamName: value("teamName") || undefined,
        partnerName: value("partnerName") || undefined,
        partnerEmail: value("partnerEmail"),
        partnerPhone: value("partnerPhone") || undefined,
        partnerGender: (value("partnerGender") || null) as "Male" | "Female" | null,
        partnerShirtSize: (value("partnerShirtSize") || null) as (typeof SHIRTS)[number] | null,
        partnerBftMember: form.get("partnerBftMember") === "on",
        partnerStudioName: value("partnerStudioName") || undefined,
      });

      if (result.ok) {
        // The row disappears by itself once the sync turns it into a team, so
        // the refresh is the whole of "it worked" — no local list surgery.
        router.refresh();
        onDone();
        return;
      }

      setFailed(true);
      setMessage(
        result.error === "NOTHING_TO_WRITE"
          ? t("Fill in at least one answer first.")
          : result.error === "DISABLED"
            ? t("The CRM sync is switched off, so nothing would come back. Turn it on first.")
            : result.error === "NOT_READ_BACK"
              ? // Said exactly: the difference between "we could not reach the
                // CRM" and "the CRM took it and kept nothing" is the difference
                // between trying again and telling somebody.
                t("The CRM accepted the change but did not store it. Nothing has been written — check the CRM form and try again.")
              : result.error === "NOT_FOUND"
                ? t("That registration is no longer on this list.")
                : result.error === "FORBIDDEN"
                  ? t("You cannot complete registrations.")
                  : t("The CRM could not be reached. Nothing was changed.")
      );
    });
  }

  return (
    <form action={save} className="intake-complete">
      {message ? (
        <div className="notice" role="status" data-tone={failed ? "warn" : undefined}>
          {message}
        </div>
      ) : null}

      <p className="reg-sub" style={{ margin: "0 0 8px" }}>
        {t(
          "This is written to the CRM, not just to PODIUM. Anything left blank is left alone — it is not erased."
        )}
      </p>

      <div className="form-grid">
        <label>
          {t("Category")}
          <select name="category" defaultValue="" disabled={pending}>
            <option value="">{t("Leave as it is")}</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(category)}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t("Division")}
          <select name="division" defaultValue="" disabled={pending}>
            <option value="">{t("Leave as it is")}</option>
            {DIVISIONS.map((division) => (
              <option key={division} value={division}>
                {t(division)}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t("Team name")}
          <input name="teamName" defaultValue={teamName ?? ""} maxLength={191} disabled={pending} />
        </label>
      </div>

      <div className="console-group-title" style={{ marginTop: 12 }}>
        {t("Second athlete")}
      </div>
      <div className="form-grid">
        <label>
          {t("Full name")}
          <input name="partnerName" defaultValue={partnerName ?? ""} maxLength={191} disabled={pending} />
        </label>
        <label>
          {t("Email")}
          <input name="partnerEmail" type="email" maxLength={191} disabled={pending} />
        </label>
        <label>
          {t("Phone")}
          <input name="partnerPhone" maxLength={191} disabled={pending} />
        </label>
        <label>
          {t("Gender")}
          <select name="partnerGender" defaultValue="" disabled={pending}>
            <option value="">{t("Leave as it is")}</option>
            <option value="Male">{t("Male")}</option>
            <option value="Female">{t("Female")}</option>
          </select>
        </label>
        <label>
          {t("T-shirt size")}
          <select name="partnerShirtSize" defaultValue="" disabled={pending}>
            <option value="">{t("Leave as it is")}</option>
            {SHIRTS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("BFT studio")}
          <select name="partnerStudioName" defaultValue="" disabled={pending}>
            <option value="">{t("Leave as it is")}</option>
            {studioNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="checkline" style={{ marginTop: 8 }}>
        <input type="checkbox" name="partnerBftMember" disabled={pending} />
        {t("They are a BFT member")}
      </label>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? t("Writing to the CRM…") : t("Save to the CRM")}
        </button>
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={onDone}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}
