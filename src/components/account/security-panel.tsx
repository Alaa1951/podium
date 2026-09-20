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

const ERRORS: Record<string, string> = {
  TOO_MANY_ATTEMPTS: "Too many attempts. Try again shortly.",
};

export function SecurityPanel({ email }: { email: string }) {
  const t = useT();
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<SignInEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/devices", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { devices: Device[]; events: SignInEvent[] };
      setDevices(data.devices);
      setEvents(data.events);
    } catch { setError(t("Could not load. Check your connection and try again.")); } finally {
      setLoaded(true);
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if(active) void load(); });
    return () => { active = false; };
  }, [load]);

  function revoke(deviceId?: string) {
    setNotice("");
    setError("");
    startTransition(async () => {
      try {
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
      } catch { setError(t("Could not save. Check your connection and try again.")); }
    });
  }

  /**
   * Changing a password is done by email, never in this form: the account
   * holder proves the mailbox, not merely that a laptop was left unlocked.
   * The link that arrives is the same one a forgotten password sends.
   */
  function requestPasswordReset() {
    setNotice("");
    setError("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/request-password-reset", { method: "POST" });
        const result = (await res.json()) as { ok?: boolean; error?: string };
        if (!result.ok) {
          setError(t(ERRORS[result.error ?? ""] ?? "Something went wrong. Try again."));
          return;
        }
        setSent(true);
      } catch { setError(t("Could not send. Check your connection and try again.")); }
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
        {sent ? (
          <p style={{ margin: 0, fontSize: 14 }} role="status">
            {t("A link is on its way to {email}. It is good for 30 minutes.", { email })}
          </p>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 14, color: "var(--text-secondary)" }}>
              {t(
                "We email you a link to set a new one — there is no old password to remember. The link is good for 30 minutes, and using it signs every device out."
              )}
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={requestPasswordReset}
              disabled={pending}
            >
              {pending ? <span className="spinner" /> : null}
              {t("Email me a link")}
            </button>
          </>
        )}
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
