"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/components/i18n/locale-provider";
import { matchesRoute, safeAppPath } from "@/lib/mobile-navigation";
import { approveHistoryBack, confirmUnsaved, readNavigationTrail } from "@/components/app/mobile-runtime";
import { NavigationProgress } from "@/components/app/navigation-progress";

export function MobileIcon({ href }: { href: string }) {
  const kind = href.split("/").filter(Boolean).at(-1) ?? "home";
  const paths: Record<string, string> = {
    home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
    series: "M5 4h14v16H5ZM8 8h8M8 12h8M8 16h5",
    studio: "M4 21V7l8-4 8 4v14M8 21v-7h8v7M8 8h1m6 0h1",
    users: "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3M15 3a4 4 0 0 1 0 8M22 21v-3a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    waves: "M3 7h18M3 12h18M3 17h18M7 4v6m10-1v6M7 14v6",
    scores: "M4 4h16v17H4ZM8 8h8M8 12h8M8 16h4",
    results: "M8 3h8v7a4 4 0 0 1-8 0ZM8 5H3v3a4 4 0 0 0 5 4m8-7h5v3a4 4 0 0 1-5 4M12 14v6m-4 1h8",
    account: "M20 21a8 8 0 0 0-16 0M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    more: "M4 6h16M4 12h16M4 18h16",
  };
  const aliases: Record<string, string> = { registrations: "users", teams: "users", me: "users", "my-wave": "waves" };
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[aliases[kind] ?? kind] ?? paths.home} /></svg>;
}

export function MobileBack({ fallback }: { fallback: string }) {
  const router = useRouter();
  const t = useT();
  return <button type="button" className="mobile-back" aria-label={t("Back")} onClick={() => {
    if (!confirmUnsaved(t("You have unsaved changes. Leave this screen?"))) return;
    const trail = readNavigationTrail();
    if (trail.length > 1 && safeAppPath(trail.at(-2) ?? null)) { approveHistoryBack(); router.back(); }
    else {
      const stored = sessionStorage.getItem(`podium:list:${fallback}`);
      let saved: { href: string; scroll: number } | null = null;
      try { saved = stored ? JSON.parse(stored) : null; } catch { /* Expired list state. */ }
      router.replace(saved && safeAppPath(saved.href) ? saved.href : fallback);
    }
  }}><span aria-hidden="true">‹</span></button>;
}

export function PersonalMobileNavigation({ role, homeHref }: { role: string; homeHref?: string }) {
  const path = usePathname();
  const t = useT();
  const items = role === "competitor"
    ? [{ href: "/me", label: "My team" }, { href: "/my-wave", label: "My wave" }, { href: "/results", label: "Results" }, { href: "/account", label: "Account" }]
    : homeHref === "/my-wave" ? [{href:"/my-wave",label:"My wave"},{href:"/results",label:"Results"},{href:"/account",label:"Account"}] : role === "studio"
      ? [{ href: "/studio", label: "Competitions" }, { href: "/results", label: "Results" }, { href: "/account", label: "Account" }]
      : [{ href: "/", label: "Dashboard" }, { href: "/series", label: "Competitions" }, { href: "/users", label: "Users" }, { href: "/?menu=more", label: "More" }];
  const commonScreen = matchesRoute(path, "/account") || matchesRoute(path, "/notifications");
  const activePath = commonScreen ? "/account" : /^\/series\/[^/]+\/board$/.test(path) ? "/results" : path;
  return <nav className="mobile-tabbar personal-tabbar" aria-label={t("Sections")}>{items.map((item) => {
    const active = item.label === "More" ? commonScreen : matchesRoute(activePath, item.href);
    return <Link key={item.href} href={item.href} data-active={active || undefined} aria-current={active ? "page" : undefined}><MobileIcon href={item.label === "More" ? "/more" : item.href} /><span>{t(item.label)}</span><NavigationProgress /></Link>;
  })}</nav>;
}
