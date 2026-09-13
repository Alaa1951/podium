"use client";

import { useEffect } from "react";

/**
 * The last resort: this replaces the root layout, so it carries its own <html>
 * and cannot rely on the stylesheet, the fonts or the locale provider. Every
 * value here is therefore inline and literal.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalErrorBoundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#07073d",
          color: "#f2f2f3",
          fontFamily: "system-ui, sans-serif",
          padding: "40px 24px",
        }}
      >
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: "#9a9aff" }}>
            PODIUM
          </div>
          <h1 style={{ fontSize: 40, textTransform: "uppercase", margin: "10px 0" }}>
            Something broke
          </h1>
          <p style={{ fontSize: 14, color: "rgba(242,242,243,0.8)" }}>
            The application could not start this page. Try again, and if it keeps happening give
            this reference to whoever is running the event.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 12, color: "#9a9aff", letterSpacing: "0.1em" }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 18,
              padding: "10px 22px",
              cursor: "pointer",
              border: "2px solid #00b5cc",
              background: "#00b5cc",
              color: "#07073d",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
