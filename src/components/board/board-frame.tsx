import Link from "next/link";

import { BoardBrand } from "@/components/board/board-brand";
import { SignOutButton } from "@/components/app/sign-out-button";
import { MobileBoardShell } from "@/components/board/mobile-board-shell";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import type { NavGroup } from "@/components/app/console-shell";
import { can } from "@/lib/access";
import { getCurrentUser, homeForUser } from "@/lib/session";
import { getTranslator } from "@/lib/i18n/server";
import { getTheme } from "@/lib/theme-server";
import { prisma } from "@/lib/prisma";

/** Desktop wall display, with scoped application navigation on phones/tablets. */
export async function BoardFrame({
  back,
  name,
  seriesSlug,
  children,
}: {
  back: string;
  name: string;
  seriesSlug: string;
  children: React.ReactNode;
}) {
  const [user, { t }, theme] = await Promise.all([getCurrentUser(), getTranslator(), getTheme()]);
  const studioMember = user?.role === "studio" && !!user.studioId && !!await prisma.seriesStudio.findFirst({
    where: { studioId: user.studioId, series: { slug: seriesSlug } },
    select: { seriesId: true },
  });
  const contextual = user?.role === "admin" || user?.role === "staff" || user?.role === "organiser" || studioMember;
  const base = `${studioMember ? "/studio" : "/series"}/${seriesSlug}`;
  const homeHref = user ? await homeForUser(user) : back;
  // The competition's overview is overview.view in the console (a gym's own
  // area is always open to it). Offering it to a judge or a volunteer only
  // bounced them back home, so they get their home instead.
  const canOverview = studioMember || (!!user && user.role !== "studio" && user.role !== "competitor" && can(user, "overview.view"));
  const backHref = !user ? back : canOverview ? base : homeHref;
  const groups: NavGroup[] = contextual && user ? [
    { title: "", items: [...(canOverview ? [{ href: base, label: t("Overview") }] : []), { href: `/series/${seriesSlug}/board`, label: t("Live board") }] },
    { title: t("Sections"), items: [
      { href: `${base}/${studioMember ? "teams" : "registrations"}`, label: t(studioMember ? "Teams" : "Athletes"), permission: "registrations.view" as const },
      { href: `${base}/waves`, label: t("Waves"), permission: "waves.view" as const },
      { href: `${base}/scores`, label: t("Score entry"), permission: "scores.view" as const },
      { href: `${base}/results`, label: t("Results"), permission: "results.view" as const },
      ...(studioMember
        ? [{ href: "/studio/announcements", label: t("Announcements"), permission: "announcements.send" as const }]
        : [{ href: `${base}/settings`, label: t("Settings"), permission: "settings.view" as const }]),
    ].filter(item => can(user, item.permission)).map(({ href, label }) => ({ href, label })) },
  ] : [];
  return (
    <MobileBoardShell groups={groups} role={user?.role ?? "competitor"} name={name} title={t("Live board")} homeHref={homeHref} overviewHref={canOverview ? base : homeHref} utilities={<><ThemeToggle current={theme} /><LanguageSwitch /></>}>
    <div className="board-frame">
      <div className="board-frame-bar">
        <Link href={backHref} className="board-frame-mark" aria-label={`${name} — back to the menu`}>
          <BoardBrand size="sm" align="start" />
          <span className="board-frame-hint">‹ Menu</span>
        </Link>
        <span className="board-frame-signout">
          <SignOutButton />
        </span>
      </div>
      <div className="board-frame-body">{children}</div>
    </div>
    </MobileBoardShell>
  );
}
