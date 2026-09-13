import Link from "next/link";

import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { listSeries } from "@/lib/queries";
import { money } from "@/lib/reports";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * WHERE EVERYTHING STANDS.
 *
 * The competition that is running (or the next one) first, because on any day
 * that matters that is the only thing anyone opens this for. Then the platform
 * totals, then the rest of the competitions.
 */
export default async function PlatformDashboard() {
  await requireRole("admin");
  const { t, locale } = await getTranslator();

  const competitions = await listSeries();

  const focus =
    competitions.find((one) => one.status === "live") ??
    competitions
      .filter((one) => one.status === "scheduled")
      .sort((a, b) => a.competitionDate.getTime() - b.competitionDate.getTime())[0] ??
    competitions[0];

  const [teams, paid, people, members, studios, invited] = await Promise.all([
    prisma.team.count(),
    prisma.team.count({ where: { paymentStatus: "paid" } }),
    prisma.competitor.count(),
    prisma.competitor.count({ where: { studioId: { not: null } } }),
    prisma.studio.count({ where: { isActive: true } }),
    prisma.user.count({ where: { status: "invited" } }),
  ]);

  const takings = await prisma.team.aggregate({
    where: { paymentStatus: "paid" },
    _sum: { amountMinor: true },
  });

  const day = (date: Date) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
      dateStyle: "medium",
      timeZone: "Asia/Qatar",
    }).format(date);

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <div className="eyebrow">{t("BFT MENA")}</div>
          <h1>{t("Dashboard")}</h1>
          <p>{t("Every PODIUM competition, and what is happening in each.")}</p>
        </div>
        <div className="screen-head-actions">
          <Link href="/series/new" className="btn btn-primary">
            {t("New competition")}
          </Link>
        </div>
      </div>

      {/* ── The one that matters today ─────────────────────────────────────── */}
      {focus ? (
        <Link href={`/series/${focus.slug}`} className="focus-card" data-status={focus.status}>
          <div className="focus-status">
            <span className={`badge ${focus.status === "live" ? "badge-live" : focus.status === "final" ? "badge-ok" : "badge-neutral"}`}>
              {focus.status === "live"
                ? t("Running now")
                : focus.status === "final"
                  ? t("Finished")
                  : t("Upcoming")}
            </span>
            <span className="focus-date">{day(focus.competitionDate)}</span>
          </div>
          <div className="focus-name">{focus.name}</div>
          <div className="focus-figures">
            <span>
              <strong className="pd-num">{focus._count.teams}</strong> {t("teams")}
            </span>
            <span>
              <strong className="pd-num">{focus._count.waves}</strong> {t("waves")}
            </span>
            <span>
              <strong className="pd-num">{focus._count.studios}</strong> {t("studios")}
            </span>
            <span className="focus-go">{t("Open")} →</span>
          </div>
        </Link>
      ) : (
        <div className="notice">
          <strong>{t("No competitions yet.")}</strong>{" "}
          {t("Create one, choose the studios taking part, and the rest follows.")}
        </div>
      )}

      {/* ── The platform, in total ─────────────────────────────────────────── */}
      <h2 className="section-title" style={{ marginTop: 30 }}>
        {t("Across every competition")}
      </h2>
      <div className="stat-grid" style={{ marginTop: 10 }}>
        <Stat label={t("Teams registered")} value={teams} note={`${paid} ${t("paid")}`} />
        <Stat
          label={t("Competitors")}
          value={people}
          note={`${members} ${t("BFT members")} · ${people - members} ${t("non-members")}`}
        />
        <Stat
          label={t("Confirmed takings")}
          value={money(takings._sum.amountMinor ?? 0, "QAR")}
        />
        <Stat
          label={t("Studios")}
          value={studios}
          note={t("in the directory")}
        />
        <Stat
          label={t("Awaiting first sign-in")}
          value={invited}
          note={invited > 0 ? t("invitations not yet used") : t("everyone is set up")}
        />
      </div>

      {/* ── All of them ────────────────────────────────────────────────────── */}
      <h2 className="section-title" style={{ marginTop: 30 }}>
        {t("Competitions")}
      </h2>
      <div className="table-scroll" style={{ marginTop: 10 }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t("Competition")}</th>
              <th style={{ width: 130 }}>{t("Date")}</th>
              <th style={{ width: 120 }}>{t("Status")}</th>
              <th style={{ width: 90, textAlign: "end" }}>{t("Teams")}</th>
              <th style={{ width: 90, textAlign: "end" }}>{t("Studios")}</th>
            </tr>
          </thead>
          <tbody>
            {competitions.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  {t("Nothing yet.")}
                </td>
              </tr>
            ) : (
              competitions.map((one) => (
                <tr key={one.id}>
                  <td>
                    <Link href={`/series/${one.slug}`} className="linkish">
                      <strong>{one.name}</strong>
                    </Link>
                  </td>
                  <td className="pd-num">{day(one.competitionDate)}</td>
                  <td>
                    <span
                      className={`badge ${one.status === "live" ? "badge-live" : one.status === "final" ? "badge-ok" : "badge-neutral"}`}
                    >
                      {one.status === "live"
                        ? t("Running")
                        : one.status === "final"
                          ? t("Finished")
                          : t("Scheduled")}
                    </span>
                  </td>
                  <td className="pd-num" style={{ textAlign: "end" }}>
                    {one._count.teams}
                  </td>
                  <td className="pd-num" style={{ textAlign: "end" }}>
                    {one._count.studios}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note ? <span className="stat-note">{note}</span> : null}
    </div>
  );
}
