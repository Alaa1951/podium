import Link from "next/link";
import { redirect } from "next/navigation";

import { ACCOUNT_TYPE_LABEL } from "@/components/accounts/account-types";
import { ApprovalBanner } from "@/components/app/approval-banner";
import { PlainHeader } from "@/components/app/plain-header";
import { can, type PermissionKey } from "@/lib/access";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { homeForUser, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Door = { href: string; label: string; key: PermissionKey };

/**
 * HOME for everyone without a console of their own — organisers, BFT MENA
 * Partial staff without the dashboard, judges between events.
 *
 * It is built from the same permission keys the screens check, so it offers
 * exactly the doors this person's roles open: nothing they would be refused
 * at, nothing they are missing. Studios and athletes have homes of their own.
 */
export default async function HomePage() {
  const user = await requireUser();
  if (user.role === "studio" || user.role === "competitor") redirect(await homeForUser(user));
  if (user.role === "admin") redirect("/");
  const { t } = await getTranslator();

  // Every competition that is coming up or running — the ones there is work
  // in — and the most recent finished ones. A flat "newest twelve" dropped a
  // scheduled competition off the page once a dozen newer ones existed.
  const select = { id: true, slug: true, name: true, status: true, competitionDate: true } as const;
  const [upcoming, finished] = await Promise.all([
    prisma.series.findMany({
      where: { archivedAt: null, status: { in: ["scheduled", "live"] } },
      orderBy: [{ competitionDate: "desc" }],
      select,
    }),
    prisma.series.findMany({
      where: { archivedAt: null, status: "final" },
      orderBy: [{ competitionDate: "desc" }],
      take: 6,
      select,
    }),
  ]);
  const competitions = [...upcoming, ...finished];

  const platform: Door[] = [
    { href: "/", label: t("Dashboard"), key: "dashboard.view" },
    { href: "/series", label: t("Competitions"), key: "competitions.view" },
    { href: "/studios", label: t("Studios"), key: "studios.view" },
    { href: "/users", label: t("Users"), key: "users.view" },
    { href: "/approvals", label: t("Approvals"), key: "approvals.view" },
    { href: "/roles", label: t("Roles"), key: "roles.view" },
    { href: "/audit", label: t("Audit log"), key: "audit.view" },
    { href: "/announcements", label: t("Announcements"), key: "announcements.send" },
  ];
  const inCompetition = (slug: string): Door[] => [
    { href: `/series/${slug}`, label: t("Overview"), key: "overview.view" },
    { href: `/series/${slug}/registrations`, label: t("Athletes"), key: "registrations.view" },
    { href: `/series/${slug}/waves`, label: t("Waves"), key: "waves.view" },
    { href: `/series/${slug}/wave-control`, label: t("Wave control"), key: "waveControl.view" },
    { href: `/series/${slug}/scores`, label: t("Score entry"), key: "scores.view" },
    { href: `/series/${slug}/results`, label: t("Results"), key: "results.view" },
    { href: `/series/${slug}/settings`, label: t("Settings"), key: "settings.view" },
    { href: `/series/${slug}/board`, label: t("Live board"), key: "board.view" },
  ];

  const open = (doors: Door[]) => doors.filter((door) => can(user, door.key));
  // The platform is BFT MENA's (see its layout): an organiser holding one of
  // these keys would be sent back here from every one of them.
  const platformDoors = user.role === "staff" ? open(platform) : [];
  const grant = await prisma.zoneStaff.findFirst({
    where: { userId: user.id, series: { status: { in: ["scheduled", "live"] } } },
    select: { id: true },
  });

  const dateFormat = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Qatar",
  });

  return (
    <>
      <PlainHeader roleLabel={t(ACCOUNT_TYPE_LABEL[user.role])} homeHref="/home" />
      <div className="page-shell" style={{ maxWidth: 960, margin: "0 auto", padding: "34px 28px 70px" }}>
        <div className="page-head">
          <div className="page-eyebrow">{user.email}</div>
          <h1 className="page-title">{t("Welcome, {name}", { name: user.name ?? user.email })}</h1>
          <p className="page-sub">{t("Everything your roles let you open, in one place.")}</p>
        </div>

        <ApprovalBanner userId={user.id} />

        {grant ? (
          <section className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>{t("My wave")}</h2>
            <p className="reg-sub">{t("You are on the floor as a judge.")}</p>
            <Link href="/my-wave" className="btn btn-primary">
              {t("Open my score sheet")}
            </Link>
          </section>
        ) : null}

        {platformDoors.length ? (
          <section className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>{t("The platform")}</h2>
            <div className="chip-row">
              {platformDoors.map((door) => (
                <Link key={door.href} href={door.href} className="chip">
                  {door.label}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <h2 className="section-title">{t("Competitions")}</h2>
        {competitions.length === 0 ? <p className="reg-sub">{t("No competitions yet.")}</p> : null}
        {competitions.map((series) => {
          const doors = open(inCompetition(series.slug));
          return (
            <section key={series.id} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong>{series.name}</strong>
                <span className="reg-sub">
                  {dateFormat.format(series.competitionDate)} ·{" "}
                  {series.status === "live" ? t("Running now") : series.status === "final" ? t("Finished") : t("Not started")}
                </span>
              </div>
              <div className="chip-row" style={{ marginTop: 10 }}>
                {doors.map((door) => (
                  <Link key={door.href} href={door.href} className="chip">
                    {door.label}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
