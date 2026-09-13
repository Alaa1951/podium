"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { useT } from "@/components/i18n/locale-provider";

const tinyLink: React.CSSProperties = {
  padding: 0,
  minHeight: 0,
  height: "auto",
  fontSize: 11,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  textDecoration: "none",
};

/** The slim bar for screens that sit outside an event (series management). */
export function PlainHeader({ roleLabel }: { roleLabel: string }) {
  const t = useT();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 20px",
        borderBottom: "1px solid var(--border)",
        minHeight: "var(--app-bar-h)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 14 }}>
        <LanguageSwitch />
        <div style={{ textAlign: "end" }}>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 600,
              fontSize: 12,
              letterSpacing: "0.06em",
            }}
          >
            {roleLabel}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Link href="/account" className="btn btn-ghost" style={tinyLink}>
              {t("Security")}
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => signOut({ callbackUrl: "/login" })}
              style={tinyLink}
            >
              {t("Sign out")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
