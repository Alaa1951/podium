import { notFound, redirect } from "next/navigation";

import { ConsoleShell, type NavGroup } from "@/components/app/console-shell";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { can, type PermissionKey } from "@/lib/access";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { getCurrentUser, homeForUser } from "@/lib/session";
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
 * The console belongs to BFT MENA and the event's organisers. Each section
 * checks the same permission key as the screen behind it, so the menu offers
 * exactly what the account's roles open. Studios and athletes have areas of
 * their own and are sent there.
 */
export default async function CompetitionLayout({
  children,
  params,
}: LayoutProps<"/series/[series]">) {
  const user = await getCurrentUser();
  if (!user) notFound();
  if (user.role === "studio" || user.role === "competitor") redirect(await homeForUser(user));
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

  // Each item names the key its screen checks. `null` means open to everyone
  // who reaches the console (the public results page is public).
  const allowed = <T extends { key: PermissionKey | null }>(items: T[]) =>
    items.filter((item) => item.key === null || can(user, item.key));

  const groups: NavGroup[] = [
    {
      title: "",
      items: allowed([
        { href: at("board"), label: t("Live board"), key: "board.view" },
        { href: at(), label: t("Overview"), key: "overview.view" },
      ]),
    },
    {
      title: t("Before the day"),
      items: allowed([
        { href: at("studios"), label: t("Studios"), badge: series._count.studios, key: "competitionStudios.view" },
        {
          href: at("registrations"),
          label: t("Athletes"),
          badge: awaitingPayment,
          alert: awaitingPayment > 0,
          key: "registrations.view",
        },
        {
          href: at("waves"),
          label: t("Waves"),
          badge: unassigned,
          alert: unassigned > 0 && teamCount > 0,
          key: "waves.view",
        },
      ]),
    },
    {
      title: t("On the day"),
      items: allowed<{ key: PermissionKey | null; href: string; label: string; title?: string }>([
        { href: at("wave-control"), label: t("Wave control"), key: "waveControl.view" },
        { href: at("scores"), label: t("Score entry"), key: "scores.view" },
        { href: at("results"), label: t("Results"), key: "results.view" },
        {
          // The results the whole world is allowed to see. It opens the same
          // door a stranger opens — /results — so the operator is always
          // looking at exactly what the public sees. The index fails closed:
          // an unpublished event simply is not on it, which the tooltip says.
          href: "/results",
          label: t("Public results"),
          title: published ? undefined : t("Not published yet"),
          key: null,
        },
      ]),
    },
    {
      title: t("Setup"),
      items: allowed([{ href: at("settings"), label: t("Settings"), key: "settings.view" }]),
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
      crumbs={
        can(user, "competitions.view")
          ? [{ href: "/series", label: t("Competitions") }]
          : [{ href: "/home", label: t("Home") }]
      }
      contextName={series.name}
      contextNote={`${date} · ${phaseLabel}${
        waveSummary.running > 0 ? ` · ${waveSummary.running} ${t("on the floor")}` : ""
      }`}
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
