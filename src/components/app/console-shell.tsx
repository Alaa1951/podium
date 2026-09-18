"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MobileBack, MobileIcon } from "@/components/app/mobile-navigation";
import { mobileTabs, parentRoute } from "@/lib/mobile-navigation";
import { NavigationProgress } from "@/components/app/navigation-progress";

import { PodiumMark } from "@/components/brand/podium-mark";
import { SignOutButton } from "@/components/app/sign-out-button";
import { ViewAsMenu } from "@/components/app/view-as-menu";
import { useT } from "@/components/i18n/locale-provider";
import { NotificationBell } from "@/components/app/notification-bell";

// ─────────────────────────────────────────────────────────────────────────────
// ONE PLACE TO STAND.
//
// There used to be three navigations — /admin, /e/[eventId] and /series — and
// moving between them is what made the system feel like separate islands. This
// is the only one now, and it has exactly two levels:
//
//   THE PLATFORM   everything BFT MENA owns: competitions, studios, people
//   A COMPETITION  everything inside one: who entered, the floor, the board
//
// The breadcrumb says which level you are on, and the sidebar only ever shows
// that level's own sections — so there is no way to be somewhere without
// knowing how you got there or how to get out.
// ─────────────────────────────────────────────────────────────────────────────

export type NavItem = {
  /** Omitted for a locked section: visible, but not openable yet. */
  href?: string;
  label: string;
  /** A figure worth seeing without opening the section. */
  badge?: number;
  /** Draws attention — something is waiting. */
  alert?: boolean;
  /** Rendered dim and unopenable — the thing it leads to is not live yet. */
  locked?: boolean;
  /** Why the section is locked, shown as its tooltip. */
  title?: string;
};

export type NavGroup = { title: string; items: NavItem[] };

export type Crumb = { href: string; label: string };

export function ConsoleShell({
  groups,
  crumbs,
  contextName,
  contextNote,
  contextHref,
  utilities,
  homeHref = "/",
  viewAs,
  children,
}: {
  groups: NavGroup[];
  /** The trail back out. Empty at the platform level. */
  crumbs: Crumb[];
  /** What this sidebar is about: PODIUM, or the competition you are inside. */
  contextName: string;
  contextNote?: string;
  contextHref?: string;
  utilities: React.ReactNode;
  /** Where the wordmark goes — each role has its own top, and "/" is BFT MENA's. */
  homeHref?: string;
  /** Admin only: the role preview sits at the top of the menu, and while one
   *  is open it names the account being viewed. */
  viewAs?: { previewing: boolean; name: string | null; role: string } | null;
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const open = search.get("menu") === "more";
  const setOpen = (value: boolean) => {
    const url = new URL(location.href);
    if (value) {
      url.searchParams.set("menu", "more");
      window.history.pushState({ podiumMenu: true }, "", url.pathname + url.search);
    } else {
      url.searchParams.delete("menu");
      if (window.history.state?.podiumMenu) window.history.back();
      else router.replace(url.pathname + url.search, { scroll: false });
    }
  };
  const tabs = mobileTabs(groups);
  const activeTab = tabs.filter((item) => isActive(pathname, item.href, groups));
  const current = groups.flatMap((group) => group.items).find((item) => isActive(pathname, item.href, groups));
  const overview = groups.flatMap((group) => group.items).find((item) => item.href && /^\/(series|studio)\/[^/]+$/.test(item.href) && (pathname === item.href || pathname.startsWith(`${item.href}/`)));
  const fallback = current?.href && pathname !== current.href ? parentRoute(pathname) : crumbs.at(-1)?.href ?? homeHref;

  return (
    <div className="console">

      <nav
        id="console-nav"
        className="console-nav"
        data-open={open || undefined}
        aria-label={t("Sections")}
      >
        <button type="button" className="mobile-menu-close" data-mobile-dismiss={open || undefined} onClick={() => setOpen(false)}>{t("Close")}</button>
        <Link href={homeHref} className="console-brand">
          <PodiumMark tone="auto" height={30} />
        </Link>

        {/* Where you are, and the way back. */}
        <div className="console-context">
          {crumbs.length > 0 ? (
            <div className="console-crumbs">
              {crumbs.map((crumb) => (
                <Link key={crumb.href} href={crumb.href}>
                  ← {crumb.label}
                </Link>
              ))}
            </div>
          ) : null}
          <div className="console-context-name">{contextName}</div>
          {contextNote ? <div className="console-context-note">{contextNote}</div> : null}
        </div>

        <div className="console-groups">
          {viewAs ? (
            <ViewAsMenu viewing={viewAs.previewing ? { name: viewAs.name, role: viewAs.role } : undefined} />
          ) : null}
          {groups.map((group) => (
            <div key={group.title} className="console-group">
              {group.title ? <div className="console-group-title">{group.title}</div> : null}
              {group.items.map((item) => {
                const active = isActive(pathname, item.href, groups);
                return item.href ? (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="console-link"
                    data-active={active || undefined}
                    aria-current={active ? "page" : undefined}
                    title={item.title}

                  >
                    <span className="console-link-label">{item.label}</span>
                    {item.badge ? (
                      <span className="console-link-badge pd-num" data-alert={item.alert || undefined}>
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                ) : (
                  <span
                    key={item.label}
                    className="console-link"
                    data-locked
                    title={item.title}
                    aria-disabled
                  >
                    <span className="console-link-label">{item.label}</span>
                  </span>
                );
              })}
            </div>
          ))}
        </div>

        <div className="console-utilities">
          {utilities}
          <Link href="/account" className="btn btn-ghost btn-sm">
            {t("Account")}
          </Link>
          <SignOutButton />
        </div>
      </nav>

      <main className="console-main">
        <header className="console-inbox-head">
          <div className="mobile-heading">
            {open ? <button className="mobile-back" type="button" aria-label={t("Back")} onClick={() => setOpen(false)}><span aria-hidden="true">‹</span></button> : pathname !== homeHref ? <MobileBack fallback={fallback} /> : <PodiumMark tone="auto" height={24} />}
            <Link href={contextHref ?? overview?.href ?? (/^\/studio\/[^/]+/.test(pathname) ? pathname.split("/").slice(0,3).join("/") : homeHref)} className="mobile-heading-title"><strong>{open ? t("More") : current?.label ?? contextName}</strong><small>{contextName}</small></Link>
          </div>
          <NotificationBell />
        </header>
        <div hidden={open} className="console-content">{children}</div>
      </main>
      <nav className="mobile-tabbar" aria-label={t("Sections")}>
        {tabs.map((item) => <Link key={item.href} href={item.href!} prefetch={activeTab.includes(item) ? false : true} aria-current={!open && activeTab.includes(item) ? "page" : undefined} data-active={!open && activeTab.includes(item) || undefined}><MobileIcon href={item.href!} /><span>{item.label}</span><NavigationProgress />{item.badge ? <b className="mobile-tab-badge">{item.badge > 99 ? "99+" : item.badge}</b> : null}</Link>)}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="console-nav" data-active={open || (!activeTab.length && !!current) || undefined}><MobileIcon href="/more" /><span>{t("More")}</span></button>
      </nav>
    </div>
  );
}

/**
 * Which row to light up.
 *
 * A prefix match alone would light "Registrations" while you are on "Waves"
 * whenever one path is a prefix of the other, so the longest matching href
 * wins — the row you are actually on, not the one above it.
 */
function isActive(pathname: string, href: string | undefined, groups: NavGroup[]) {
  if (!href) return false;
  const matches = groups
    .flatMap((group) => group.items)
    .map((item) => item.href)
    .filter((candidate): candidate is string => !!candidate)
    .filter((candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`));

  if (matches.length === 0) return false;
  return href === matches.reduce((a, b) => (b.length > a.length ? b : a));
}
