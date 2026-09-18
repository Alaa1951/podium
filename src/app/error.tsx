"use client";

import { useEffect } from "react";
import { RecoveryLink } from "@/components/app/recovery-link";
import { useT } from "@/components/i18n/locale-provider";

/**
 * The in-app crash screen. It keeps the PODIUM ground rather than dropping to
 * an unstyled page, and never prints the error message — a stack or a database
 * string on a venue screen is both alarming and a leak. The digest is enough to
 * find the real error in the server log.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t=useT();
  useEffect(() => {
    console.error("[ErrorBoundary]", error);
  }, [error]);

  return (
    <div
      data-route-error="true"
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        background: "var(--color-accent-900)",
        color: "var(--on-navy)",
      }}
    >
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "var(--color-accent-300)",
          }}
        >
          PODIUM
        </div>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 600,
            fontSize: "clamp(38px,7vw,72px)",
            lineHeight: 0.95,
            textTransform: "uppercase",
            margin: "8px 0 12px",
          }}
        >
          {t("Something broke")}
        </h1>
        <p style={{ fontSize: 14, color: "var(--on-navy-secondary)" }}>
          {t("This screen could not load. Changes are saved only after confirmation; unsaved changes may need to be entered again.")}
        </p>
        {error.digest ? (
          <p
            className="pd-num"
            style={{ fontSize: 12, color: "var(--color-accent-400)", letterSpacing: "0.1em" }}
          >
            {t("Reference")}: {error.digest}
          </p>
        ) : null}

        <div style={{ display: "flex", flexWrap:"wrap", gap: 10, justifyContent: "center", marginTop: 22 }}>
          <button type="button" className="btn btn-cyan" onClick={() => retry()}>
            {t("Try again")}
          </button>
          {/*
            "Try again" re-renders the failed tree; this one leaves it entirely
            and starts from the landing route.
          */}
          <RecoveryLink className="btn btn-cyan-outline">{t("Start again")}</RecoveryLink>
        </div>
      </div>
    </div>
  );
}
