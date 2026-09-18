import type { ReactNode } from "react";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { PublicBrand } from "@/components/board/board-brand";

/**
 * The sign-in card: the same near-black ground and centered stacked mark the
 * public results use — one brand world from the first screen — with a single
 * column no wider than a phone.
 */
export async function AuthShell({
  title,
  blurb,
  children,
  footer,
}: {
  title: string;
  blurb?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className="auth-shell"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        background:
          "radial-gradient(120% 80% at 50% 0%, rgba(7, 7, 61, 0.6) 0%, transparent 60%), var(--board-bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 460 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
          <PublicBrand height={46} />
        </div>
        <h1
          style={{
            textAlign: "center",
            fontFamily: "var(--font-brand), var(--font-heading), sans-serif",
            fontWeight: 800,
            fontSize: 24,
            textTransform: "uppercase",
            color: "var(--on-navy)",
            margin: "18px 0 8px",
          }}
        >
          {title}
        </h1>

        {blurb ? (
          <p
            style={{
              fontSize: 13,
              color: "var(--on-navy-secondary)",
              textAlign: "center",
              margin: "0 0 20px",
            }}
          >
            {blurb}
          </p>
        ) : null}

        {children}

        <div
          style={{
            marginTop: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
          }}
        >
          <LanguageSwitch tone="dark" />
        </div>

        {footer ? (
          <div style={{ marginTop: 14, textAlign: "center", fontSize: 12, color: "var(--on-navy-muted)" }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
