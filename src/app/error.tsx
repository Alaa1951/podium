"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The in-app crash screen. It keeps the PODIUM ground rather than dropping to
 * an unstyled page, and never prints the error message — a stack or a database
 * string on a venue screen is both alarming and a leak. The digest is enough to
 * find the real error in the server log.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ErrorBoundary]", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100vh",
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
          Something broke
        </h1>
        <p style={{ fontSize: 14, color: "var(--on-navy-secondary)" }}>
          The screen could not be drawn. Nothing you entered has been lost — scores are only
          ever saved when you press submit.
        </p>
        {error.digest ? (
          <p
            className="pd-num"
            style={{ fontSize: 12, color: "var(--color-accent-400)", letterSpacing: "0.1em" }}
          >
            Reference: {error.digest}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22 }}>
          <button type="button" className="btn btn-cyan" onClick={() => reset()}>
            Try again
          </button>
          {/*
            "Try again" re-renders the failed tree; this one leaves it entirely
            and starts from the landing route.
          */}
          <Link href="/" className="btn btn-cyan-outline" style={{ textDecoration: "none" }}>
            Start again
          </Link>
        </div>
      </div>
    </div>
  );
}
