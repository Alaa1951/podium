"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { useT } from "@/components/i18n/locale-provider";
import { MobileIcon } from "@/components/app/mobile-navigation";
import { NavigationProgress } from "@/components/app/navigation-progress";
import { SignOutButton } from "@/components/app/sign-out-button";
import { hasContextNavigation, matchesRoute } from "@/lib/mobile-navigation";
import {
  personalNavActivePath,
  personalNavCommonScreen,
  personalNavItems,
  personalNavHref,
} from "@/lib/personal-navigation";

/**
 * A COMPETITOR'S NAVIGATION ON A WIDE SCREEN.
 *
 * Everybody else gets the console's sidebar, which carries its own links and
 * its own way out. A competitor never does — all three console layouts turn
 * the role away — so until now their entire navigation was the phone's tab
 * bar, and CSS deletes that above 900px. On a laptop, "Partner requests" had
 * no way back to anything.
 *
 * Same four destinations as the tab bar, from the same list
 * (personal-navigation.ts), so the two can no longer drift apart.
 */
export function PersonalDesktopNavigation({ role, homeHref }: { role: string; homeHref?: string }) {
  const path = usePathname();
  const seriesId = useSearchParams().get("series");
  const t = useT();

  // Staff and studios have the sidebar; this must not add a second bar to it.
  if (role !== "competitor") return null;
  // A screen with its own context navigation, and the wall board, both keep
  // the full-screen frame they were designed with.
  if (hasContextNavigation(path)) return null;
  if (/^\/series\/[^/]+\/board$/.test(path)) return null;

  const items = personalNavItems(role, homeHref);
  const commonScreen = personalNavCommonScreen(path, matchesRoute);
  const activePath = personalNavActivePath(path, commonScreen);

  return (
    <nav className="personal-rail desktop-only" aria-label={t("Sections")}>
      {items.map((item) => {
        const active = matchesRoute(activePath, item.href);
        return (
          <Link
            key={item.href}
            href={personalNavHref(item.href, role, seriesId)}
            prefetch={active ? false : true}
            data-active={active || undefined}
            aria-current={active ? "page" : undefined}
          >
            <MobileIcon href={item.href} />
            <span>{t(item.label)}</span>
            <NavigationProgress />
          </Link>
        );
      })}
      <span className="personal-rail-end">
        <SignOutButton />
      </span>
    </nav>
  );
}
