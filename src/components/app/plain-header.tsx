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
  const mobileTitle = ({"/home":"Home","/me":"My team","/studio":"Competitions","/my-wave":"My wave","/account":"Account","/notifications":"Notifications","/me/edit":"Edit team"} as Record<string,string>)[path] ?? (path.startsWith("/studio/announcements") ? "Announcements" : path.startsWith("/my-wave/") ? "My wave" : undefined);

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
