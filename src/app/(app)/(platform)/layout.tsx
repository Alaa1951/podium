import { redirect } from "next/navigation";

import { ConsoleShell, type NavGroup } from "@/components/app/console-shell";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { can } from "@/lib/access";
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
 * BFT MENA sees all of it. Any other account passes only when its access role
 * carries at least one platform permission, and its navigation is filtered to
 * exactly that.
 */
export default async function PlatformLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const { t } = await getTranslator();
  const theme = await getTheme();

  const platformViews = ["users.view", "studios.view", "audit.view", "roles.manage"];
  const onPlatform = user.role === "admin" || platformViews.some((p) => can(user, p));
  if (!onPlatform) redirect(await homeForUser(user));

  const [competitions, studios, invited] = await Promise.all([
    prisma.series.count(),
    prisma.studio.count({ where: { isActive: true } }),
    prisma.user.count({ where: { status: "invited" } }),
  ]);

  const isAdmin = user.role === "admin";
  // Non-admin platform users (custom access roles) see exactly what their
  // permissions open — the page guards still enforce every door behind these.
  const groups: NavGroup[] = [
    {
      title: "",
      items: [{ href: "/", label: t("Dashboard") }].filter(() => isAdmin),
    },
    {
      title: t("The platform"),
      items: [
        { href: "/series", label: t("Competitions"), badge: competitions },
        { href: "/studios", label: t("Studios"), badge: studios },
        // An invited account has not signed in yet — worth noticing.
        { href: "/users", label: t("Users"), badge: invited, alert: invited > 0 },
      ].filter((item) => {
        if (isAdmin) return true;
        if (item.href === "/studios") return can(user, "studios.view");
        if (item.href === "/users") return can(user, "users.view");
        // Competitions list is the admin overview; the series console itself
        // is reachable by URL for custom-role users.
        return false;
      }),
    },
    {
      title: t("Records"),
      items: [{ href: "/audit", label: t("Audit log") }].filter(
        () => isAdmin || can(user, "audit.view")
      ),
    },
    {
      title: t("Access"),
      items: [{ href: "/roles", label: t("Roles") }].filter(
        () => isAdmin || can(user, "roles.manage")
      ),
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
