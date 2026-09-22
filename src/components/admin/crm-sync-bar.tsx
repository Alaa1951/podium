"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { syncCrmNow } from "@/lib/actions/crm-sync";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE CRM LAST SAID, and a way to ask it again.
//
// The poll runs every fifteen minutes. That is fine until the morning of a
// competition, when somebody pays at the door and a pair stands waiting for a
// timer. This is the button that skips the wait.
//
// It renders NOTHING when the sync is switched off, so the screen is exactly
// as it was for anyone who is not using the CRM.
// ─────────────────────────────────────────────────────────────────────────────

const ERRORS: Record<string, string> = {
  BUSY: "A sync is already running. Give it a moment.",
  DISABLED: "The CRM sync is switched off.",
  FORBIDDEN: "You are not allowed to do that.",
};

export type CrmSyncStatus = {
  running: boolean;
  lastSuccessAt: Date | null;
  lastCreated: number;
  lastUpdated: number;
  lastWaiting: number;
  lastSkipped: number;
  lastError: string | null;
};

export function CrmSyncBar({ status }: { status: CrmSyncStatus }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  function run() {
    setMessage("");
    setFailed(false);
    startTransition(async () => {
      const result = await syncCrmNow();
      if (result.ok) {
        setMessage(t(result.message));
        router.refresh();
        return;
      }
      setFailed(true);
      // A failure message from the sync is already redacted by the client —
      // a status and a short code, never a response body full of contacts.
      setMessage(t(ERRORS[result.error] ?? result.error));
    });
  }

  return (
    <div className="notice" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0, flex: "1 1 260px" }}>
        <strong>{t("Registrations come from the CRM")}</strong>{" "}
        <span className="reg-sub">
          {status.lastSuccessAt
            ? t("Last sync brought in {created} and updated {updated}.", {
                created: status.lastCreated,
                updated: status.lastUpdated,
              })
            : t("No sync has finished yet.")}
          {status.lastWaiting > 0
            ? ` ${t("{n} are not teams yet — they are listed below.", { n: status.lastWaiting })}`
            : ""}
        </span>
        {status.lastError ? (
          <div className="reg-sub" style={{ color: "var(--status-danger-text)" }}>
            {status.lastError}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending || status.running}
        onClick={run}
        style={{ height: 34, fontSize: 13 }}
      >
        {pending || status.running ? t("Syncing…") : t("Sync now")}
      </button>

      {message ? (
        <div
          className={failed ? "notice-error" : undefined}
          role="status"
          style={{ flexBasis: "100%", margin: 0 }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
