"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { RefusedCodeNotice } from "@/components/auth/refused-code-notice";
import { useT } from "@/components/i18n/locale-provider";
import { requestCompetitorCode } from "@/lib/actions/competitor-login";
import { codeErrorMessage, resendWaitMessage, sendLimitMessage } from "@/lib/otp-messages";

// ─────────────────────────────────────────────────────────────────────────────
// SIGNING IN AS AN ATHLETE.
//
// A code by email is the whole sign-in: they gave an email when they
// registered, and that is the credential. A password is theirs to add later
// from Account if they want one; it is never required.
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
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  function ask() {
    setError("");
    setNote("");
    startTransition(async () => {
      const result = await requestCompetitorCode({ email });
      if (!result.ok) {
        setError(result.error === "TOO_MANY" ? sendLimitMessage(result.retryAfter, t) : t("That email does not look right."));
        return;
      }
      // Asked again within the cooldown: the code already sent is still the one.
      if (result.resendIn) setNote(resendWaitMessage(result.resendIn, t));
      setStage("code");
    });
  }

  async function verify() {
    setError("");
    setBusy(true);

    const attempt = () => signIn("competitor", { redirect: false, email, code: code.trim() });
    // A stale CSRF cookie comes back as "success" pointing at ?csrf=true, with
    // no session; the second try carries a fresh token.
    let result = await attempt();
    if (result?.url?.includes("csrf=true")) result = await attempt();

    setBusy(false);

    if (result?.error === "CODE_REFUSED") {
      setRefused(true);
      return;
    }
    if (!result || result.url?.includes("csrf=true")) {
      setError(t("Something went wrong. Try again."));
      return;
    }
    if (result.error) {
      setError(codeErrorMessage(result.error, t));
      return;
    }

    router.replace("/me");
    router.refresh();
  }

  if (stage === "email") {
    return (
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
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
        {/* Staff accounts never get a code here (competitor-access.ts): said
            to everyone, so it tells nobody who has which account. */}
        <p className="auth-note">{t("Judges, organisers, volunteers, coaches and gyms sign in with their email and password.")}</p>
      </form>
    );
  }

  return (
    <form
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
    >
      <h1 className="auth-title">{t("Check your email")}</h1>
      <p className="auth-sub">
        {t("If {email} has a PODIUM entry or account, a six-digit code is on its way.", { email })}
      </p>

      {refused ? <RefusedCodeNotice kind="code" /> : null}
      {note ? <p className="auth-note" role="status">{note}</p> : null}
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

      <p className="auth-note">{t("You stay signed in until you sign out.")}</p>
    </form>
  );
}
