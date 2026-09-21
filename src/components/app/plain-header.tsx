"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { useT } from "@/components/i18n/locale-provider";
import { NotificationBell } from "@/components/app/notification-bell";
import { PodiumMark } from "@/components/brand/podium-mark";
import { MobileBack } from "@/components/app/mobile-navigation";
import { usePathname } from "next/navigation";
import { parentRoute } from "@/lib/mobile-navigation";
import { screenTitle } from "@/lib/personal-navigation";

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
export function PlainHeader({ roleLabel, homeHref = "/", backHref }: { roleLabel: string; homeHref?: string; backHref?: string }) {
  const t = useT();
  const path = usePathname();
  const mobileTitle = screenTitle(path);
  // Where "back" goes on a WIDE screen. A home screen has nowhere above it;
  // everything else walks up one, the same targets the mobile arrow uses.
  const desktopBack = ["/me", "/studio", "/my-wave", "/home"].includes(path)
    ? null
    : backHref ?? (["/account", "/notifications"].includes(path) ? homeHref : parentRoute(path));

  return (
    <>
    <div
      className="plain-header"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "calc(10px + var(--safe-top)) calc(20px + var(--safe-right)) 10px calc(20px + var(--safe-left))",
        borderBottom: "1px solid var(--border)",
        minHeight: "var(--app-bar-h)",
        flexWrap: "wrap",
      }}
    >
      <div className="mobile-heading">{["/me","/studio","/my-wave"].includes(path) ? <PodiumMark tone="auto" height={22} /> : <MobileBack fallback={backHref ?? (["/account","/notifications"].includes(path) ? homeHref : parentRoute(path))} />}<strong>{mobileTitle ? t(mobileTitle) : roleLabel}</strong></div>
      {/* The same two facts for a wide screen. A real link rather than the
          mobile arrow: there is no navigation trail to walk on desktop, and a
          link can be opened in a new tab. */}
      <div className="desktop-only plain-header-title">
        {desktopBack ? (
          <Link href={desktopBack} className="btn btn-ghost btn-sm" style={{ textDecoration: "none" }}>
            ← {t("Back")}
          </Link>
        ) : null}
        {mobileTitle ? <strong>{t(mobileTitle)}</strong> : null}
      </div>
      <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 14 }}>
        <NotificationBell />
        <div className="desktop-only"><LanguageSwitch /></div>
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
    {/* Keep the offset with this route. Next can retain a hidden console from
        the previous screen, so document-wide :has() cannot pick the shell. */}
    <div className="native-header-spacer" aria-hidden="true" />
    </>
  );
}
