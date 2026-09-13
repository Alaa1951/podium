import { notFound } from "next/navigation";

import { ConsoleShell, type NavGroup } from "@/components/app/console-shell";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { getStudioSeriesBySlug } from "@/lib/studio-queries";
import { getTheme } from "@/lib/theme-server";

export const dynamic = "force-dynamic";

/**
 * THE STUDIO DASHBOARD.
 *
 * The manual gives a studio two tabs and no more: the teams it entered, and
 * the results for those teams. Everything else about a competition — the waves,
 * the other studios, the board, the settings — is BFT MENA's, and a studio
 * account has no route to any of it.
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

  const teamCount = await prisma.team.count({
    where: { seriesId: series.id, studioId: user.studioId ?? "__none__" },
  });

  const at = (section: string) => `/studio/${series.slug}/${section}`;

  const groups: NavGroup[] = [
    {
      title: "",
      items: [
        { href: at("teams"), label: t("Teams"), badge: teamCount },
        // Present either way, so a studio can see that scores exist and who
        // holds them, rather than the tab silently not being there.
        { href: at("scores"), label: t("Score entry") },
        { href: at("waves"), label: t("Waves") },
        { href: at("results"), label: t("Results") },
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
