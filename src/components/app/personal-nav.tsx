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
 * THE PERSONAL BAR ON A WIDE SCREEN, for every screen with no sidebar of its
 * own.
 *
 * Inside a console (the platform, a competition, a gym's area) the sidebar
 * carries the links and the way out, and this stays away. Everywhere else —
 * an athlete's pages, and Home, the judge sheet and Account for everybody —
 * the phone's tab bar was the only navigation, and CSS deletes it above
 * 900px: on a laptop a judge's sheet had no way to Results, and "Partner
 * requests" had no way back to anything.
 *
 * Same destinations as the tab bar, from the same list
 * (personal-navigation.ts), so the two can no longer drift apart.
 */
export function PersonalDesktopNavigation({ role, homeHref }: { role: string; homeHref?: string }) {
  const path = usePathname();
  const seriesId = useSearchParams().get("series");
  const t = useT();

  // A screen with its own context navigation (the console sidebar), and the
  // wall board, both keep the frame they were designed with.
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
