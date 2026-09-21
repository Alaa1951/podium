"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ACCOUNT_TYPE_LABEL, type AccountType } from "@/components/accounts/account-types";
import { useT } from "@/components/i18n/locale-provider";
import { sendResetLink, updateAccount } from "@/lib/actions/account-admin";
import { confirmUnsaved, useUnsavedChanges } from "@/components/app/mobile-runtime";

// ─────────────────────────────────────────────────────────────────────────────
// CORRECTING ONE ACCOUNT.
//
// Opens under the row it belongs to rather than in a dialog, so the list stays
// on screen and it is obvious which person is being changed. The reset link is
// here too: the commonest thing anybody needs from this screen is to get
// somebody back in, and it should not take a second trip.
// ─────────────────────────────────────────────────────────────────────────────

export type EditableAccount = {
  id: string;
  name: string | null;
  email: string;
  role: AccountType;
  studioId: string | null;
  requestedSeriesId: string | null;
};

const ERRORS: Record<string, string> = {
  CANNOT_CHANGE_OWN_ACCOUNT: "You cannot change your own account — ask another admin.",
  CANNOT_CHANGE_OWN_ACCESS: "You cannot change your own account — ask another admin.",
  FORBIDDEN: "You are not allowed to do that.",
  EMAIL_ALREADY_REGISTERED: "Another account already uses that email.",
  EMAIL_INVALID: "That email does not look right.",
  STUDIO_REQUIRED: "A studio account has to be assigned to a studio.",
  ACCOUNT_DISABLED: "This account is disabled. Enable it first.",
  NOT_FOUND: "That account no longer exists.",
};

export function AccountEditor({
  account,
  studios,
  competitions,
  canMakeFullAdmin = false,
  onDone,
}: {
  account: EditableAccount;
  studios: { id: string; name: string }[];
  /** Competitions an athlete can be attached to. Empty hides the field. */
  competitions: { id: string; name: string }[];
  /** Only BFT MENA Full access makes (or unmakes) BFT MENA Full access. */
  canMakeFullAdmin?: boolean;
  onDone: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(account.name ?? "");
  const [email, setEmail] = useState(account.email);
  const [role, setRole] = useState(account.role);
  const [studioId, setStudioId] = useState(account.studioId ?? "");
  const [seriesId, setSeriesId] = useState(account.requestedSeriesId ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savedDraft, setSavedDraft] = useState("");
  const fingerprint = JSON.stringify([name, email, role, studioId, seriesId]);
  const original = JSON.stringify([account.name ?? "", account.email, account.role, account.studioId ?? "", account.requestedSeriesId ?? ""]);
  useUnsavedChanges(fingerprint !== (savedDraft || original));

  function report(result: { ok: boolean; error?: string; message?: string }) {
    if (result.ok) {
      setError("");
      setMessage(result.message ?? t("Saved."));
      router.refresh();
      return;
    }
    setMessage("");
    setError(t(ERRORS[result.error ?? ""] ?? "Something went wrong. Try again."));
  }

  function save() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const result = await updateAccount({
            userId: account.id,
            name,
            email,
            role,
            studioId: role === "admin" || role === "staff" ? null : studioId || null,
            requestedSeriesId: role === "competitor" ? seriesId || null : null,
          });
        if (result.ok) setSavedDraft(fingerprint);
        report(result);
      } catch { setError(t("Could not save. Check your connection and try again.")); }
    });
  }

  function reset() {
    setError("");
    setMessage("");
    startTransition(async () => report(await sendResetLink({ userId: account.id })));
  }

  return (
    <div className="account-editor" data-unsaved={fingerprint !== (savedDraft || original)}>
      {error ? (
        <div className="notice-error" role="alert" style={{ marginBottom: 10 }}>
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="notice" style={{ marginBottom: 10 }}>
          {message}
        </div>
      ) : null}

      <div className="form-row">
        <label style={{ flex: "1 1 180px" }}>
          <span className="field-label">{t("Name")}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label style={{ flex: "2 1 240px" }}>
          <span className="field-label">{t("Email")}</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      </div>

      <div className="form-row">
        <label style={{ flex: "1 1 160px" }}>
          <span className="field-label">{t("Account type")}</span>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as EditableAccount["role"])}
          >
            {(["admin", "staff", "studio", "organiser", "competitor"] as const)
              .filter((type) => type !== "admin" || canMakeFullAdmin || account.role === "admin")
              .map((type) => (
                <option key={type} value={type} disabled={type === "admin" && !canMakeFullAdmin}>
                  {t(ACCOUNT_TYPE_LABEL[type])}
                </option>
              ))}
          </select>
        </label>

        {role !== "admin" && role !== "staff" ? (
          <label style={{ flex: "1 1 200px" }}>
            <span className="field-label">{t("Studio")}</span>
            <select
              className="input"
              value={studioId}
              onChange={(e) => setStudioId(e.target.value)}
            >
              <option value="">{t("Not assigned")}</option>
              {studios.map((studio) => (
                <option key={studio.id} value={studio.id}>
                  {studio.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {/* Which competition an athlete signed up for. Set by hand for anybody
            who signed up before the form asked, and whenever somebody moves. */}
        {role === "competitor" && competitions.length > 0 ? (
          <label style={{ flex: "1 1 200px" }}>
            <span className="field-label">{t("Competition")}</span>
            <select className="input" value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
              <option value="">{t("Not assigned")}</option>
              {competitions.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="form-row mobile-action-bar" style={{ marginTop: 14 }}>
        <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>
          {pending ? <span className="spinner" /> : null}
          {t("Save changes")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={reset} disabled={pending}>
          {t("Email a password reset link")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={()=>{if(confirmUnsaved(t("You have unsaved changes. Leave this screen?")))onDone();}} disabled={pending}>
          {t("Close")}
        </button>
      </div>

      <p className="reg-sub" style={{ marginTop: 8, maxWidth: "60ch" }}>
        {t(
          "The reset link is single-use and short-lived, and sending one cancels any earlier link. It is emailed — never shown here."
        )}
      </p>
    </div>
  );
}
