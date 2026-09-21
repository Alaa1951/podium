"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { useT } from "@/components/i18n/locale-provider";

export function ForgotPasswordForm() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } finally {
      // Always the same answer, sent or not — the form must never reveal which
      // addresses hold accounts.
      setSent(true);
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div style={{ textAlign: "center" }}>
        <p style={{ color: "var(--on-navy-strong)", fontSize: 14 }}>
          {t("If that email has an account, a reset link is on its way.")}
        </p>
        <Link href="/login" className="btn btn-block btn-primary-outline">
          {t("Sign in")}
        </Link>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <label className="field-label-dark" htmlFor="email">
          {t("Email")}
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          className="input input-dark"
          placeholder="you@studio.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <button type="submit" className="btn btn-block btn-primary" disabled={loading}>
        {loading ? <span className="spinner" /> : null}
        {t("Send reset link")}
      </button>

      <Link
        href="/login"
        className="btn btn-block btn-primary-outline"
        style={{ textDecoration: "none" }}
      >
        {t("Back")}
      </Link>
    </form>
  );
}
