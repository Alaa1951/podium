"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useUnsavedChanges } from "@/components/app/mobile-runtime";
import { useT } from "@/components/i18n/locale-provider";

const RULES_MESSAGE =
  "Use at least 10 characters, with an uppercase letter, a lowercase letter and a number.";

/** Shared by the invitation flow (/activate) and the reset flow. */
export function SetPasswordForm({
  token,
  purpose,
}: {
  token: string;
  purpose: "invite" | "reset";
}) {
  const t = useT();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  useUnsavedChanges(!done && (!!password || !!confirm));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError(t("Passwords do not match."));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, purpose, password, confirmPassword: confirm }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        if (data.error?.startsWith("PASSWORD_")) setError(t(RULES_MESSAGE));
        else if (data.error === "PASSWORDS_DO_NOT_MATCH") setError(t("Passwords do not match."));
        else if (data.error === "INVALID_TOKEN") setError(t("That link is invalid or has expired."));
        else setError(t("Something went wrong. Try again."));
        return;
      }

      setDone(true);
      setTimeout(() => router.replace("/login"), 1200);
    } catch {
      setError(t("Something went wrong. Try again."));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div style={{ textAlign: "center" }}>
        <p style={{ color: "var(--bft-cyan)", fontSize: 15 }}>{t("Password set. You can sign in now.")}</p>
        <Link href="/login" className="btn btn-block btn-primary-outline">
          {t("Sign in")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <label className="field-label-dark" htmlFor="password">
          {t("New password")}
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          className="input input-dark"
          placeholder="••••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div>
        <label className="field-label-dark" htmlFor="confirm">
          {t("Confirm password")}
        </label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          className="input input-dark"
          placeholder="••••••••••"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "var(--on-navy-muted)" }}>{t(RULES_MESSAGE)}</p>

      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--danger-bright)" }}>
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-block btn-primary" disabled={loading}>
        {loading ? <span className="spinner" /> : null}
        {t("Set your password")}
      </button>
    </form>
  );
}
