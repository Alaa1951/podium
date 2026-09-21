/**
 * WHERE A PERSON CAN GO, in one place.
 *
 * The same four destinations have to appear in two different bars — the phone's
 * tab bar and the desktop rail — and they drifted apart once already: the tab
 * bar was the ONLY navigation a competitor had, and CSS deletes it above 900px,
 * so a competitor on a laptop had no way out of the page they were on. Keeping
 * the list here means the two bars cannot disagree again.
 *
 * Pure: no React, no Prisma, no secrets. Both bars and the tests import it.
 */

export type PersonalNavItem = { href: string; label: string };

/**
 * The bar for an account type. `homeHref` is what `homeForUser` resolved to,
 * which is how somebody working a zone gets the judge's bar whatever their
 * account type says.
 */
export function personalNavItems(role: string, homeHref?: string): PersonalNavItem[] {
  if (role === "competitor") {
    return [
      { href: "/me", label: "My team" },
      { href: "/my-wave", label: "My wave" },
      { href: "/results", label: "Results" },
      { href: "/account", label: "Account" },
    ];
  }
  if (homeHref === "/my-wave") {
    return [
      { href: "/my-wave", label: "My wave" },
      { href: "/results", label: "Results" },
      { href: "/account", label: "Account" },
    ];
  }
  if (role === "studio") {
    return [
      { href: "/studio", label: "Competitions" },
      { href: "/results", label: "Results" },
      { href: "/account", label: "Account" },
    ];
  }
  if (role === "admin" || homeHref === "/") {
    return [
      { href: "/", label: "Dashboard" },
      { href: "/series", label: "Competitions" },
      { href: "/users", label: "Users" },
      { href: "/?menu=more", label: "More" },
    ];
  }
  return [
    { href: "/home", label: "Home" },
    { href: "/results", label: "Results" },
    { href: "/account", label: "Account" },
  ];
}

/** Account and the inbox share one tab; the wall board counts as Results. */
export function personalNavCommonScreen(path: string, matches: (a: string, b: string) => boolean) {
  return matches(path, "/account") || matches(path, "/notifications");
}

/** The path the bar should highlight against. */
export function personalNavActivePath(path: string, commonScreen: boolean) {
  if (commonScreen) return "/account";
  if (/^\/series\/[^/]+\/board$/.test(path)) return "/results";
  return path;
}

/**
 * The name of a screen, for a header that has no room for a breadcrumb.
 *
 * Returns undefined where the screen's own heading is enough and the header
 * should fall back to who the person is.
 */
export function screenTitle(path: string): string | undefined {
  const known: Record<string, string> = {
    "/home": "Home",
    "/me": "My team",
    "/me/edit": "Edit team",
    "/me/partner": "Find a partner",
    "/me/partner/requests": "Partner requests",
    "/studio": "Competitions",
    "/my-wave": "My wave",
    "/account": "Account",
    "/notifications": "Notifications",
  };
  if (known[path]) return known[path];
  if (path.startsWith("/studio/announcements")) return "Announcements";
  if (path.startsWith("/my-wave/")) return "My wave";
  return undefined;
}
