import type { NavGroup, NavItem } from "@/components/app/console-shell";

export function matchesRoute(path: string, href: string) {
  return path === href || (href !== "/" && path.startsWith(`${href}/`));
}

/** Pick the current route's shell, not DOM left behind by retained screens. */
export function hasContextNavigation(path: string) {
  if (path === "/" || ["/series", "/users", "/approvals", "/studios", "/roles", "/audit", "/announcements"].some(prefix => matchesRoute(path, prefix))) return true;
  return path.startsWith("/studio/") && !matchesRoute(path, "/studio/announcements");
}

/** Navigation is derived from the already permission-filtered server menu. */
export function mobileTabs(groups: NavGroup[]): NavItem[] {
  const items = groups.flatMap((group) => group.items).filter((item) => item.href && !item.locked);
  const inCompetition = items.some((item) => /^\/(series|studio)\/[^/]+\/(scores|registrations|teams|waves|results)$/.test(item.href!));
  const sections = inCompetition
    ? ["registrations", "teams", "waves", "scores", "results"]
    : ["/", "/studio", "/series", "/users"];
  return sections.flatMap((section) => {
    const item = items.find((candidate) => inCompetition
      ? candidate.href!.endsWith(`/${section}`) && candidate.href !== "/results"
      : candidate.href === section);
    return item ? [item] : [];
  }).slice(0, 4);
}

export function parentRoute(path: string) {
  const clean = path.replace(/\/(edit|new)$/, "");
  if (clean !== path) return clean;
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

export function safeAppPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return null;
  const pathname = value.split(/[?#]/)[0];
  if (/^\/(login|verify|competitor|activate|reset-password|forgot-password)(\/|$)/.test(pathname)) return null;
  return value;
}
