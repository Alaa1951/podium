"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { PodiumMark } from "@/components/brand/podium-mark";
import { SignOutButton } from "@/components/app/sign-out-button";
import { ViewAsMenu } from "@/components/app/view-as-menu";
import { useT } from "@/components/i18n/locale-provider";

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
  utilities,
  homeHref = "/",
  viewAsControl = false,
  children,
}: {
  groups: NavGroup[];
  /** The trail back out. Empty at the platform level. */
  crumbs: Crumb[];
  /** What this sidebar is about: PODIUM, or the competition you are inside. */
  contextName: string;
  contextNote?: string;
  utilities: React.ReactNode;
  /** Where the wordmark goes — each role has its own top, and "/" is BFT MENA's. */
  homeHref?: string;
  /** Admin in their own name: the role preview sits at the top of the menu. */
  viewAsControl?: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="console">
      <button
        type="button"
        className="console-burger btn btn-secondary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="console-nav"
      >
        {open ? t("Close") : t("Menu")}
      </button>

      <nav
        id="console-nav"
        className="console-nav"
        data-open={open || undefined}
        aria-label={t("Sections")}
      >
        <Link href={homeHref} className="console-brand" onClick={() => setOpen(false)}>
          <PodiumMark tone="auto" height={30} />
        </Link>

        {/* Where you are, and the way back. */}
        <div className="console-context">
          {crumbs.length > 0 ? (
            <div className="console-crumbs">
              {crumbs.map((crumb) => (
                <Link key={crumb.href} href={crumb.href} onClick={() => setOpen(false)}>
                  ← {crumb.label}
                </Link>
              ))}
            </div>
          ) : null}
          <div className="console-context-name">{contextName}</div>
          {contextNote ? <div className="console-context-note">{contextNote}</div> : null}
        </div>

        <div className="console-groups">
          {viewAsControl ? <ViewAsMenu /> : null}
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
                    onClick={() => setOpen(false)}
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
          <SignOutButton />
        </div>
      </nav>

      {open ? <div className="console-scrim" onClick={() => setOpen(false)} aria-hidden /> : null}

      <main className="console-main">{children}</main>
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
