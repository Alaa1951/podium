"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Field } from "@/components/admin/registration-fields";
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

// IT IS BUILT FROM `Field` AND `className="input"`, like every other form
// here, and that is not a style preference. The first version used bare
// <label> and bare controls: on the console's dark surface an unstyled input
// has no border and no background, so the boxes were there and invisible, and
// the form looked broken while working perfectly.
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
  /**
   * Closes the form, and carries what happened out with it.
   *
   * IT HAS TO BE SAID SOMEWHERE THAT OUTLIVES THIS COMPONENT. On success the
   * form unmounts, and the row itself only disappears if the sync managed to
   * make it a team — so a busy sync used to look exactly like nothing having
   * happened, on the one screen where "did my write land?" is the question.
   */
  onDone: (message?: string) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** Only ever a failure: success refreshes the list and closes the form. */
  const [problem, setProblem] = useState("");

  function save(form: FormData) {
    setProblem("");
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
        onDone(result.message);
        return;
      }

      setProblem(
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
    // Bounded, and inside the row rather than across it: the table is as wide
    // as the screen, and a form stretched to that width puts a label at one
    // edge and its answer at the other.
    <form action={save} className="form-block" style={{ maxWidth: 780, margin: "4px 0" }}>
      {problem ? (
        <div className="status-banner" data-tone="warn" role="status">
          {problem}
        </div>
      ) : null}

      <p className="reg-sub" style={{ margin: "0 0 4px" }}>
        {t(
          "This is written to the CRM, not just to PODIUM. Anything left blank is left alone — it is not erased."
        )}
      </p>

      <div className="form-row">
        <Field label={t("Category")} hint={t("who is competing")}>
          <select className="input" name="category" defaultValue="" disabled={pending}>
            <option value="">{t("Leave as it is")}</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(category)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("Division")} hint={t("the level they compete at")}>
          <select className="input" name="division" defaultValue="" disabled={pending}>
            <option value="">{t("Leave as it is")}</option>
            {DIVISIONS.map((division) => (
              <option key={division} value={division}>
                {t(division)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("Team name")} hint={t("left blank, takes the first competitor's name")}>
          <input
            className="input"
            name="teamName"
            defaultValue={teamName ?? ""}
            maxLength={191}
            disabled={pending}
          />
        </Field>
      </div>

      <h2 className="section-title" style={{ marginTop: 16 }}>
        {t("Second athlete")}
      </h2>
      <div className="form-row">
        <Field label={t("Full name")}>
          <input
            className="input"
            name="partnerName"
            defaultValue={partnerName ?? ""}
            maxLength={191}
            disabled={pending}
          />
        </Field>
        <Field label={t("Email")}>
          <input className="input" name="partnerEmail" type="email" maxLength={191} disabled={pending} />
        </Field>
        <Field label={t("Phone")}>
          <input className="input" name="partnerPhone" maxLength={191} disabled={pending} />
        </Field>
      </div>

      <div className="form-row">
        <Field label={t("Gender")}>
          <select className="input" name="partnerGender" defaultValue="" disabled={pending}>
            <option value="">{t("Leave as it is")}</option>
            <option value="Male">{t("Male")}</option>
            <option value="Female">{t("Female")}</option>
          </select>
        </Field>
        <Field label={t("T-shirt size")}>
          <select className="input" name="partnerShirtSize" defaultValue="" disabled={pending}>
            <option value="">{t("Leave as it is")}</option>
            {SHIRTS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("BFT studio")}>
          <select className="input" name="partnerStudioName" defaultValue="" disabled={pending}>
            <option value="">{t("Leave as it is")}</option>
            {studioNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="form-row">
        <label className="checkline">
          <input type="checkbox" name="partnerBftMember" disabled={pending} />
          <span>{t("They are a BFT member")}</span>
        </label>
      </div>

      <div className="form-row" style={{ marginTop: 14 }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? t("Writing to the CRM…") : t("Save to the CRM")}
        </button>
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => onDone()}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}
