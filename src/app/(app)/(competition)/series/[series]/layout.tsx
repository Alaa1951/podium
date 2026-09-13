import { notFound } from "next/navigation";

import { ConsoleShell, type NavGroup } from "@/components/app/console-shell";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { can } from "@/lib/access";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { getCurrentUser } from "@/lib/session";
import { getTheme } from "@/lib/theme-server";

export const dynamic = "force-dynamic";

/**
 * INSIDE ONE COMPETITION.
 *
 * The sections follow the order the work actually happens in: who is taking
 * part, who entered, how they are dealt onto the floor, what they scored, what
 * the room sees, and what the result was. Settings last, because it is the
 * thing you touch once.
 *
 * BFT MENA sees every section. An account carrying an access role sees exactly
 * the sections its permissions open, and never lands here without at least one.
 */
export default async function CompetitionLayout({
  children,
  params,
}: LayoutProps<"/series/[series]">) {
  const user = await getCurrentUser();
  if (!user) notFound();
  const { t, locale } = await getTranslator();
  const theme = await getTheme();

  const { series, waveSummary, teamCount, phase } = await requireSeries(params);
  const at = (section = "") => seriesHref(series.slug, section);

  const [awaitingPayment, unassigned] = await Promise.all([
    prisma.team.count({ where: { seriesId: series.id, paymentStatus: "pending" } }),
    prisma.team.count({ where: { seriesId: series.id, waveId: null } }),
  ]);

  // The public results item mirrors what a stranger sees at /results: it only
  // opens once the event is finished AND published, and it opens on the
  // bracket with the most finishers — the one people actually come for.
  const published =
    series.status === "final" &&
    series.resultsPublicAt !== null &&
    series.resultsPublicAt <= new Date();

  const topBracket = await prisma.team.groupBy({
    by: ["category", "division"],
    where: { seriesId: series.id, paymentStatus: "paid", score: { status: "submitted" } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  const front = topBracket[0];

  const maySee = (permission: string) => can(user, permission);

  const groups: NavGroup[] = [
    {
      title: "",
      items: [
        { href: at("board"), label: t("Live board") },
        { href: at(), label: t("Overview") },
      ].filter((item) => user.role === "admin" || item.href === at() || maySee("board.view")),
    },
    {
      title: t("Before the day"),
      items: [
        { href: at("studios"), label: t("Studios"), badge: series._count.studios },
        {
          href: at("registrations"),
          label: t("Competitors"),
          badge: awaitingPayment,
          alert: awaitingPayment > 0,
        },
        {
          href: at("waves"),
          label: t("Waves"),
          badge: unassigned,
          alert: unassigned > 0 && teamCount > 0,
        },
      ].filter((item) => {
        if (user.role === "admin") return true;
        if (item.href === at("studios")) return maySee("studios.view");
        if (item.href === at("registrations")) return maySee("competitors.view");
        if (item.href === at("waves")) return maySee("waves.view");
        return true;
      }),
    },
    {
      title: t("On the day"),
      items: [
        { href: at("scores"), label: t("Score entry") },
        { href: at("results"), label: t("Results") },
        {
          // The results the whole world is allowed to see. Dimmed until the
          // event is finished and published, so it is never a surprise 404.
          href:
            published && front
              ? `/results/${series.slug}/${front.category}/${front.division}`
              : undefined,
          label: t("Public results"),
          locked: !published || !front,
          title: published ? undefined : t("Not published yet"),
        },
      ].filter((item) => {
        if (user.role === "admin") return true;
        if ("href" in item && item.href === at("scores")) return maySee("scores.view");
        if ("href" in item && item.href === at("results")) return maySee("results.view");
        return true;
      }),
    },
    {
      title: t("Setup"),
      items: [{ href: at("settings"), label: t("Settings") }].filter(
        () => user.role === "admin" || maySee("settings.view")
      ),
    },
  ];

  const phaseLabel =
    phase === "before" ? t("Not started") : phase === "live" ? t("Running now") : t("Finished");

  const date = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Qatar",
  }).format(series.competitionDate);

  return (
    <ConsoleShell
      groups={groups}
      crumbs={[{ href: "/series", label: t("Competitions") }]}
      contextName={series.name}
      contextNote={`${date} · ${phaseLabel}${
        waveSummary.running > 0 ? ` · ${waveSummary.running} ${t("on the floor")}` : ""
      }`}
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
