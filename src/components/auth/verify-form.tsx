"use client";

import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useEffect, useState, type FormEvent } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { getDevicePayload } from "@/lib/device-client";

export function VerifyForm({
  email,
  callbackUrl,
  trust,
}: {
  email: string;
  callbackUrl: string;
  trust: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (code.trim().length !== 6) {
      setError(t("Enter the six-digit code."));
      return;
    }
    setLoading(true);
    setError("");

    try {
      const device = getDevicePayload();
      const res = await signIn("otp", {
        email,
        code: code.trim(),
        deviceFingerprint: device.deviceFingerprint,
        deviceLabel: device.deviceLabel,
        browser: device.browser,
        os: device.os,
        deviceType: device.deviceType,
        trustThisDevice: String(trust),
        redirect: false,
        callbackUrl,
      });

      if (res?.error) {
        setError(t("That code is not valid or has expired."));
        return;
      }

      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError(t("Something went wrong. Try again."));
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setError("");
    setNotice("");
    // A resend issues a different code, so whatever digits are sitting in the
    // field are now certainly stale — leaving them there is how the fresh
    // code burns its five attempts on one careless press of Verify.
    setCode("");
    try {
      const res = await fetch("/api/auth/resend-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { cooldownSeconds?: number };
      setCooldown(data.cooldownSeconds ?? 60);
      setNotice(t("Code sent again."));
    } catch {
      setError(t("Something went wrong. Try again."));
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 13, color: "var(--on-navy-secondary)", textAlign: "center", margin: 0 }}>
        {t("We sent a six-digit code to")} <strong style={{ color: "var(--on-navy)" }}>{email}</strong>
      </p>

      <div>
        <label className="field-label-dark" htmlFor="code">
          {t("Verification code")}
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          className="input input-dark pd-num"
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          style={{ fontSize: 30, letterSpacing: "0.42em", textAlign: "center" }}
        />
        {/* Development only: with no SMTP configured, the code is written to the
            server log instead of an inbox — say so, or the screen waits on an
            email that is never coming. */}
        {process.env.NODE_ENV !== "production" ? (
          <p className="reg-sub" style={{ margin: "6px 0 0", textAlign: "center" }}>
            {t("Dev: read the code from the server log — npm run otp")}
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--danger-bright)" }}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--bft-cyan)" }}>{notice}</p>
      ) : null}

      <button type="submit" className="btn btn-block btn-primary" disabled={loading}>
        {loading ? <span className="spinner" /> : null}
        {t("Verify and continue")}
      </button>

      <button
        type="button"
        className="btn btn-block btn-primary-outline"
        onClick={resend}
        disabled={cooldown > 0}
      >
        {cooldown > 0 ? `${t("Resend code")} (${cooldown}s)` : t("Resend code")}
      </button>
    </form>
  );
}
