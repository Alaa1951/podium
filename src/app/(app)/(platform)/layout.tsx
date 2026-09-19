import { redirect } from "next/navigation";

import { ConsoleShell, type NavGroup } from "@/components/app/console-shell";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { can, canAny, type PermissionKey } from "@/lib/access";
import { countPendingSignups } from "@/lib/approvals";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { homeForUser, requireUser } from "@/lib/session";
import { getTheme } from "@/lib/theme-server";

export const dynamic = "force-dynamic";

/**
 * THE PLATFORM LEVEL.
 *
 * What BFT MENA owns across every competition: the competitions themselves,
 * the studios that take part in them, and the people who sign in. Nothing on
 * this level belongs to one competition — that is the level below.
 *
 * BFT MENA Full sees all of it. BFT MENA Partial staff and organisers pass
 * when their roles carry at least one platform permission, and the navigation
 * is filtered to exactly that — each item checks the same key as the screen
 * behind it. Studios and athletes have areas of their own.
 */
export default async function PlatformLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const { t } = await getTranslator();
  const theme = await getTheme();

  const platformViews: PermissionKey[] = [
    "dashboard.view",
    "competitions.view",
    "studios.view",
    "users.view",
    "approvals.view",
    "roles.view",
    "audit.view",
    "announcements.send",
  ];
  const onPlatform =
    user.role === "admin" ||
    ((user.role === "staff" || user.role === "organiser") && canAny(user, platformViews));
  if (!onPlatform) redirect(await homeForUser(user));

  const [competitions, studios, invited, waiting] = await Promise.all([
    prisma.series.count(),
    prisma.studio.count({ where: { isActive: true } }),
    prisma.user.count({ where: { status: "invited", signupType: null } }),
    countPendingSignups(user),
  ]);

  // Each item carries the key its screen checks, so the menu can never offer
  // a door that refuses — the page guards still enforce every one of them.
  const allowed = <T extends { key: PermissionKey }>(items: T[]) =>
    items.filter((item) => can(user, item.key));
  const groups: NavGroup[] = [
    {
      title: "",
      items: allowed([{ href: "/", label: t("Dashboard"), key: "dashboard.view" }]),
    },
    {
      title: t("The platform"),
      items: allowed([
        { href: "/series", label: t("Competitions"), badge: competitions, key: "competitions.view" },
        { href: "/studios", label: t("Studios"), badge: studios, key: "studios.view" },
        // An invited account has not signed in yet — worth noticing.
        { href: "/users", label: t("Users"), badge: invited, alert: invited > 0, key: "users.view" },
        // Sign-ups waiting for someone to let them in.
        { href: "/approvals", label: t("Approvals"), badge: waiting, alert: waiting > 0, key: "approvals.view" },
        { href: "/announcements", label: t("Announcements"), key: "announcements.send" },
      ]),
    },
    {
      title: t("Records"),
      items: allowed([{ href: "/audit", label: t("Audit log"), key: "audit.view" }]),
    },
    {
      title: t("Access"),
      items: allowed([{ href: "/roles", label: t("Roles"), key: "roles.view" }]),
    },
  ];

  return (
    <ConsoleShell
      groups={groups}
      crumbs={[]}
      contextName={t("PODIUM platform")}
      contextNote={t("BFT MENA")}
      viewAs={
        user.role === "admin"
          ? { previewing: !!user.viewAs, name: user.name, role: user.role }
          : null
      }
      utilities={
        <>
          <ThemeToggle current={theme} />
          <LanguageSwitch />
        </>
      }
    >
      {children}
    </ConsoleShell>
  );
}
