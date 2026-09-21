"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { getDevicePayload } from "@/lib/device-client";

// One form for everyone. The role is never chosen here — the server reads it
// from the account, so this screen cannot be used to probe who is an admin.

function readAuthError(res: { error?: string | null; url?: string | null } | undefined) {
  const raw = res?.error;
  if (raw) return decodeURIComponent(raw);
  if (!res?.url || typeof window === "undefined") return "";
  try {
    return new URL(res.url, window.location.origin).searchParams.get("error") ?? "";
  } catch {
    return "";
  }
}

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [trustDevice, setTrustDevice] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const device = getDevicePayload();
      const res = await signIn("credentials", {
        email,
        password,
        deviceFingerprint: device.deviceFingerprint,
        deviceLabel: device.deviceLabel,
        browser: device.browser,
        os: device.os,
        deviceType: device.deviceType,
        trustThisDevice: String(trustDevice),
        redirect: false,
        callbackUrl,
      });

      const authError = readAuthError(res ?? undefined);

      if (authError.includes("OTP_REQUIRED")) {
        const params = new URLSearchParams({
          email,
          callbackUrl,
          trust: String(trustDevice),
        });
        router.replace(`/verify?${params.toString()}`);
        return;
      }
      if (authError.includes("ACCOUNT_DISABLED")) {
        setError(t("This account has been disabled. Contact BFT MENA."));
        return;
      }
      if (authError.includes("ACCOUNT_NOT_ACTIVATED")) {
        setError(
          t(
            "This account is not active yet. Use the code or the link in the email we sent you, then your password will work."
          )
        );
        return;
      }
      if (authError.includes("TOO_MANY_ATTEMPTS")) {
        setError(t("Too many attempts. Try again shortly."));
        return;
      }
      if (authError) {
        setError(t("Incorrect email or password."));
        return;
      }

      router.replace(callbackUrl);
      router.refresh();
    } catch {
      setError(t("Something went wrong. Try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <label className="field-label-dark" htmlFor="email">
          {t("Email")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="input input-dark"
          placeholder="you@studio.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label className="field-label-dark" htmlFor="password">
          {t("Password")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input input-dark"
          placeholder="••••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 12,
          color: "var(--on-navy-secondary)",
          marginTop: 4,
          flexWrap: "wrap",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={trustDevice}
            onChange={(e) => setTrustDevice(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: "var(--bft-cyan)", cursor: "pointer" }}
          />
          {t("Trust this device")}
        </label>
        <Link href="/forgot-password" style={{ color: "var(--color-accent-300)" }}>
          {t("Forgot password?")}
        </Link>
      </div>

      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--danger-bright)" }}>
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-block btn-primary" disabled={loading}>
        {loading ? <span className="spinner" /> : null}
        {loading ? t("Signing in…") : t("Sign in")}
      </button>

      {/* Athletes do not have a password and never will — they arrive by
          code. Sending them through the staff form is how they get stuck. */}
      <p className="auth-note">
        {t("Competing in PODIUM?")}{" "}
        <Link href="/athlete" style={{ color: "var(--bft-cyan)" }}>
          {t("Athlete sign-in")}
        </Link>
      </p>
      <p className="auth-note">
        {t("New here?")}{" "}
        <Link href="/signup" style={{ color: "var(--bft-cyan)" }}>
          {t("Sign up")}
        </Link>
      </p>
    </form>
  );
}
