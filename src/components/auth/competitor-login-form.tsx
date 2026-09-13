"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { requestCompetitorCode } from "@/lib/actions/competitor-login";

// ─────────────────────────────────────────────────────────────────────────────
// SIGNING IN AS A COMPETITOR.
//
// No password, because there never was one: they gave an email when they
// registered, and that is the credential. Ask for a code, type it in, done —
// and they stay in for a day, which is how long a competition and the evening
// of arguing about it actually lasts.
//
// The screen says the same thing whether or not the address competed. Whether
// somebody is in PODIUM is not a fact a stranger gets to test with a form.
// ─────────────────────────────────────────────────────────────────────────────

export function CompetitorLoginForm() {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function ask() {
    setError("");
    startTransition(async () => {
      const result = await requestCompetitorCode({ email });
      if (!result.ok) {
        setError(
          result.error === "TOO_MANY"
            ? t("Too many requests. Wait a few minutes and try again.")
            : t("That email does not look right.")
        );
        return;
      }
      setStage("code");
    });
  }

  async function verify() {
    setError("");
    setBusy(true);

    const result = await signIn("competitor", {
      redirect: false,
      email,
      code: code.trim(),
    });

    setBusy(false);

    if (!result || result.error) {
      setError(t("That code is not valid or has expired."));
      return;
    }

    router.push("/me");
    router.refresh();
  }

  if (stage === "email") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <h1 className="auth-title">{t("Competitor sign-in")}</h1>
        <p className="auth-sub">
          {t("Use the email you registered with. We will send you a six-digit code.")}
        </p>

        {error ? (
          <div className="notice-error" role="alert" style={{ marginBottom: 14 }}>
            {error}
          </div>
        ) : null}

        <label style={{ display: "block" }}>
          <span className="field-label-dark">{t("Email")}</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            autoFocus
          />
        </label>

        <button
          type="submit"
          className="btn btn-block btn-primary"
          disabled={pending || email.trim().length < 5}
          style={{ marginTop: 16 }}
        >
          {pending ? <span className="spinner" /> : null}
          {t("Send me a code")}
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
    >
      <h1 className="auth-title">{t("Check your email")}</h1>
      <p className="auth-sub">
        {t("If {email} registered for PODIUM, a six-digit code is on its way.", { email })}
      </p>

      {error ? (
        <div className="notice-error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      ) : null}

      <label style={{ display: "block" }}>
        <span className="field-label-dark">{t("Verification code")}</span>
        <input
          className="input otp-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          required
          autoFocus
        />
      </label>

      <button
        type="submit"
        className="btn btn-block btn-primary"
        disabled={busy || code.length !== 6}
        style={{ marginTop: 16 }}
      >
        {busy ? <span className="spinner" /> : null}
        {t("Sign in")}
      </button>

      <button
        type="button"
        className="btn btn-block btn-ghost"
        onClick={() => {
          setStage("email");
          setCode("");
          setError("");
        }}
        disabled={busy}
        style={{ marginTop: 8 }}
      >
        {t("Use a different email")}
      </button>

      <p className="auth-note">{t("You will stay signed in for 24 hours.")}</p>
    </form>
  );
}
