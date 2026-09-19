import { notFound } from "next/navigation";

import { ConsoleShell, type NavGroup } from "@/components/app/console-shell";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { can } from "@/lib/access";
import { countPendingSignups } from "@/lib/approvals";
import { getTranslator } from "@/lib/i18n/server";
import { requireRole } from "@/lib/session";
import { getStudioSeriesBySlug } from "@/lib/studio-queries";
import { getTheme } from "@/lib/theme-server";
import { canComposeAnnouncements } from "@/lib/notification-access";

export const dynamic = "force-dynamic";

/**
 * THE STUDIO DASHBOARD.
 *
 * A studio runs its own part of a competition: its teams, where they stand in
 * the waves, their scores and results, and its own people. Each tab checks the
 * same permission as the screen behind it (the Gym/Studio role, editable by
 * BFT MENA). Everything else — other studios, settings, the floor — belongs to
 * BFT MENA and the organisers, and a studio account has no route to it.
 *
 * It is the same shell as the console above, on purpose. A studio is not using
 * a lesser product; it is standing in a smaller part of the same one.
 */
export default async function StudioSeriesLayout({
  children,
  params,
}: LayoutProps<"/studio/[series]">) {
  const user = await requireRole("studio");
  const { t, locale } = await getTranslator();
  const theme = await getTheme();

  const { series: slug } = await params;
  const series = await getStudioSeriesBySlug(user, slug);
  // Not "forbidden" — a studio that is not in this competition is told nothing
  // about whether it exists.
  if (!series) notFound();

  const teamCount = series.teamCount;
  // Sign-ups naming this studio, waiting for it (or BFT MENA) to decide.
  const waiting = await countPendingSignups(user);

  const at = (section: string) => `/studio/${series.slug}/${section}`;

  const groups: NavGroup[] = [
    {
      title: "",
      items: [
        ...(can(user, "registrations.view") ? [{ href: at("teams"), label: t("Teams"), badge: teamCount }] : []),
        ...(can(user, "scores.view") ? [{ href: at("scores"), label: t("Scores") }] : []),
        ...(can(user, "waves.view") ? [{ href: at("waves"), label: t("Waves") }] : []),
        ...(can(user, "results.view") ? [{ href: at("results"), label: t("Results") }] : []),
        ...(can(user, "users.view")
          ? [{ href: "/studio/people", label: t("People"), badge: waiting || undefined, alert: waiting > 0 }]
          : []),
        ...(canComposeAnnouncements(user) ? [{ href: "/studio/announcements", label: t("Announcements") }] : []),
      ],
    },
  ];

  const date = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Qatar",
  }).format(series.competitionDate);

  return (
    <ConsoleShell
      groups={groups}
      crumbs={[{ href: "/studio", label: t("Your competitions") }]}
      contextName={series.name}
      contextNote={`${date}${series.venue ? ` · ${series.venue}` : ""}`}
      homeHref="/studio"
      viewAs={
        user.role === "studio" && user.viewAs
          ? { previewing: true, name: user.name, role: user.role }
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
