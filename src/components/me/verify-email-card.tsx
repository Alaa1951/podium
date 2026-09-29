"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { RefusedCodeNotice } from "@/components/auth/refused-code-notice";
import { useT } from "@/components/i18n/locale-provider";
import { requestMyVerificationCode } from "@/lib/actions/competitor-login";

/**
 * Shown on My team when the signed-in athlete's account has not proven its
 * current address: until it does, no seat can be linked to it and no entry
 * can appear. One button sends a code to that address; typing it proves the
 * address, links the seat and the team appears on the next render.
 */
export function VerifyEmailCard({ email }: { email: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [stage, setStage] = useState<"idle" | "code">("idle");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);

  function send() {
    setError("");
    startTransition(async () => {
      const result = await requestMyVerificationCode();
      if (!result.ok) {
        setError(result.error === "TOO_MANY" ? t("Too many requests. Wait a few minutes and try again.") : t("Something went wrong. Try again."));
        return;
      }
      setStage("code");
    });
  }

  async function verify() {
    setError("");
    setRefused(false);
    setBusy(true);
    const attempt = () => signIn("competitor", { redirect: false, email, code: code.trim() });
    let result = await attempt();
    if (result?.url?.includes("csrf=true")) result = await attempt();
    setBusy(false);
    if (result?.error === "CODE_REFUSED") {
      setRefused(true);
      return;
    }
    if (!result || result.error || result.url?.includes("csrf=true")) {
      setError(t("That code is not valid or has expired."));
      return;
    }
    router.refresh();
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-kicker">{t("Verify your email")}</div>
      <p className="reg-sub">
        {t("Your entry is linked to the email it was registered with. Verify {email} to see it here.", { email })}
      </p>
      {refused ? <RefusedCodeNotice kind="code" /> : null}
      {error ? (
        <div className="notice-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}
      {stage === "idle" ? (
        <button type="button" className="btn btn-primary" disabled={pending} onClick={send} style={{ marginTop: 10 }}>
          {pending ? <span className="spinner" /> : null}
          {t("Send me a code")}
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void verify();
          }}
          style={{ marginTop: 10, display: "grid", gap: 8, maxWidth: 320 }}
        >
          <label className="field-label" htmlFor="verify-code">
            {t("Verification code")}
          </label>
          <input
            id="verify-code"
            className="input otp-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            required
          />
          <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
            {busy ? <span className="spinner" /> : null}
            {t("Verify")}
          </button>
        </form>
      )}
    </section>
  );
}
