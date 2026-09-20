"use client";

import { signOut } from "next-auth/react";
import { useState, useTransition } from "react";

import { BlueprintCard } from "@/components/app/page-shell";
import { useT } from "@/components/i18n/locale-provider";
import { deleteOwnAccount } from "@/lib/actions/my-account";

const ERRORS: Record<string, string> = {
  LAST_ADMIN: "This is the only administrator account. Give somebody else admin access first.",
  FORBIDDEN: "You cannot delete this account.",
};

/**
 * Deleting your own account, from your own account screen.
 *
 * Two steps on purpose: the first button only opens the warning, so nothing
 * irreversible sits one stray tap away on a phone. On success the session is
 * cleared here rather than waited out.
 */
export function DeleteAccountPanel() {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function remove() {
    setError("");
    startTransition(async () => {
      try {
        const result = await deleteOwnAccount();
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
          return;
        }
        await signOut({ callbackUrl: "/login" });
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  return (
    <>
      <h2 className="section-title">{t("Delete account")}</h2>
      <BlueprintCard style={{ padding: "20px 22px", maxWidth: 520, gap: 12 }}>
        {error ? (
          <div className="notice-error" role="alert">
            {error}
          </div>
        ) : null}

        {confirming ? (
          <>
            <p style={{ margin: 0, fontSize: 14 }}>
              {t(
                "Delete your account? You will be signed out and will not be able to sign in again. This cannot be undone from here."
              )}
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-danger"
                onClick={remove}
                disabled={pending}
              >
                {pending ? <span className="spinner" /> : null}
                {t("Yes, delete my account")}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirming(false)}
                disabled={pending}
              >
                {t("Cancel")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 14, color: "var(--text-secondary)" }}>
              {t(
                "Deleting your account closes it for good: you are signed out everywhere and can no longer sign in. Results from competitions you have already taken part in stay on the published boards."
              )}
            </p>
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => setConfirming(true)}
            >
              {t("Delete account")}
            </button>
          </>
        )}
      </BlueprintCard>
    </>
  );
}
