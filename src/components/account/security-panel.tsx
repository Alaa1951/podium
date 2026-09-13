"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { BlueprintCard } from "@/components/app/page-shell";
import { useT } from "@/components/i18n/locale-provider";
import {
  ActivityTable,
  DeviceTable,
  type Device,
  type SignInEvent,
} from "@/components/account/security-tables";

const PASSWORD_RULES =
  "Use at least 10 characters, with an uppercase letter, a lowercase letter and a number.";

const ERRORS: Record<string, string> = {
  PASSWORDS_DO_NOT_MATCH: "Passwords do not match.",
  CURRENT_PASSWORD_WRONG: "That is not your current password.",
  PASSWORD_UNCHANGED: "That is the password you already have.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Try again shortly.",
  PASSWORD_TOO_SHORT: PASSWORD_RULES,
  PASSWORD_NEEDS_NUMBER: PASSWORD_RULES,
  PASSWORD_NEEDS_LOWER: PASSWORD_RULES,
  PASSWORD_NEEDS_UPPER: PASSWORD_RULES,
};

export function SecurityPanel() {
  const t = useT();
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<SignInEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/devices", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { devices: Device[]; events: SignInEvent[] };
      setDevices(data.devices);
      setEvents(data.events);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function revoke(deviceId?: string) {
    setNotice("");
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/auth/devices/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(deviceId ? { deviceId } : { all: true }),
      });
      const data = (await res.json()) as { ok?: boolean; revoked?: number };
      if (!data.ok) {
        setError(t("Something went wrong. Try again."));
        return;
      }
      setNotice(
        deviceId
          ? t("That device will be asked for a code next time.")
          : t("Every device will be asked for a code next time.")
      );
      await load();
    });
  }

  function changePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setNotice("");
    setError("");

    startTransition(async () => {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: String(data.get("currentPassword") || ""),
          newPassword: String(data.get("newPassword") || ""),
          confirmPassword: String(data.get("confirmPassword") || ""),
        }),
      });
      const result = (await res.json()) as { ok?: boolean; error?: string };

      if (!result.ok) {
        setError(t(ERRORS[result.error ?? ""] ?? "Something went wrong. Try again."));
        return;
      }
      form.reset();
      setNotice(
        t("Password changed. Every device was signed out and will need a code next time.")
      );
      await load();
    });
  }

  return (
    <>
      {notice ? (
        <div className="notice" style={{ marginTop: 20 }}>
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="notice-error" style={{ marginTop: 20 }} role="alert">
          {error}
        </div>
      ) : null}

      <h2 className="section-title">{t("Change password")}</h2>
      <BlueprintCard style={{ padding: "20px 22px", maxWidth: 520, gap: 10 }}>
        <form onSubmit={changePassword} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label className="field-label" htmlFor="currentPassword">
              {t("Current password")}
            </label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              className="input"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="newPassword">
              {t("New password")}
            </label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              className="input"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="confirmPassword">
              {t("Confirm password")}
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              className="input"
            />
          </div>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
            {t(PASSWORD_RULES)}
          </p>
          <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
            {pending ? <span className="spinner" /> : null}
            {t("Change password")}
          </button>
        </form>
      </BlueprintCard>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <h2 className="section-title" style={{ marginBottom: 8 }}>
          {t("Trusted devices")}
        </h2>
        {devices.length > 0 ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => revoke()}
            disabled={pending}
            style={{ marginInlineStart: "auto", marginBottom: 8 }}
          >
            {t("Remove all")}
          </button>
        ) : null}
      </div>

      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 0 }}>
        {t(
          "A trusted browser skips the emailed code for thirty days. Remove one you no longer recognise and it will be challenged again."
        )}
      </p>

      <DeviceTable devices={devices} loaded={loaded} pending={pending} onRevoke={revoke} />

      <h2 className="section-title">{t("Recent sign-in activity")}</h2>
      <ActivityTable events={events} loaded={loaded} />
    </>
  );
}
