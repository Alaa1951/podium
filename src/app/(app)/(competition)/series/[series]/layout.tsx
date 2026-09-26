import { notFound, redirect } from "next/navigation";

import { ConsoleShell, type NavGroup } from "@/components/app/console-shell";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { can, isBft, teamScope, type PermissionKey } from "@/lib/access";
import { getTranslator } from "@/lib/i18n/server";
import { countPairedNotRegistered } from "@/lib/partner-watch";
import { prisma } from "@/lib/prisma";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { countWaitingList } from "@/lib/waiting-list";
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

  const { series, waveSummary, phase } = await requireSeries(params);
  const at = (section = "") => seriesHref(series.slug, section);

  // EVERY BADGE COUNTS THE FIELD, and the field is what is left after the
  // withdrawn and the waiting are taken out. Both used to be inside these
  // numbers, which made them read as work nobody could ever finish: a team on
  // the waiting list has no wave ON PURPOSE, so "N not in a wave" had a floor
  // it could not go below for as long as anybody was waiting.
  const onTheField = { seriesId: series.id, archivedAt: null, waitlistedAt: null };

  const [awaitingPayment, unassigned, waitingPairs, waiting] = await Promise.all([
    prisma.team.count({ where: { ...onTheField, paymentStatus: "pending" } }),
    prisma.team.count({ where: { ...onTheField, waveId: null } }),
    countPairedNotRegistered(series.id),
    // Scoped the way the screen is: a studio counts its own waiting teams and
    // never the CRM half, which is BFT MENA's alone.
    countWaitingList(series.id, { includeIntake: isBft(user), scope: teamScope(user) }),
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
          href: at("waiting"),
          label: t("Waiting list"),
          // Every row here is somebody's move: ours to admit, or theirs to
          // finish the form. A finished competition's queue is history.
          badge: waiting.total,
          alert: waiting.total > 0 && series.status !== "final",
          key: "registrations.view",
        },
        {
          href: at("partners"),
          label: t("Partner watch"),
          // Two people who agreed and were never entered is the one thing on
          // this menu that quietly costs the competition an entry.
          badge: waitingPairs,
          alert: waitingPairs > 0,
          key: "registrations.partners",
        },
        {
          href: at("waves"),
          label: t("Waves"),
          badge: unassigned,
          // No `teamCount` guard any more: it came from `series._count.teams`,
          // which counts archived and waiting teams too — the same disease.
          // It is redundant regardless, since no field teams means no
          // unassigned ones.
          alert: unassigned > 0,
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
      // The logo leads where this person belongs — "/" is BFT MENA's platform,
      // which would only bounce an organiser back to /home.
      homeHref={await homeForUser(user)}
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
