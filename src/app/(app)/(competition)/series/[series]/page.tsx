import Link from "next/link";

import { getTranslator } from "@/lib/i18n/server";
import { getSeriesReport, money } from "@/lib/reports";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * WHERE THIS COMPETITION STANDS.
 *
 * The funnel in the order it happens — studios, registrations, payment, the
 * floor, the scores — with every figure a link into the section that can
 * change it. A number you cannot act on is decoration.
 */
export default async function CompetitionOverview(props: PageProps<"/series/[series]">) {
  await requireRole("admin");
  const { t, locale } = await getTranslator();

  const { series, waveSummary, phase } = await requireSeries(props.params);
  const report = await getSeriesReport(series.id);

  const at = (section = "") => seriesHref(series.slug, section);
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  // What is standing in the way, in the order it has to be dealt with.
  const blocking = [
    series._count.zones === 0 && {
      text: t("No scoring definition — scores cannot be entered."),
      href: at("settings"),
      action: t("Define the zones"),
    },
    series._count.studios === 0 && {
      text: t("No studios are taking part yet."),
      href: at("studios"),
      action: t("Choose studios"),
    },
    report.pending > 0 && {
      text: t("{n} registration(s) are not paid, so they are not on the board.", {
        n: report.pending,
      }),
      href: `${at("registrations")}?payment=pending`,
      action: t("Review payments"),
    },
    report.registered > 0 &&
      report.inWave < report.registered && {
        text: t("{n} team(s) are not in a wave.", { n: report.registered - report.inWave }),
        href: at("waves"),
        action: t("Build the running order"),
      },
  ].filter(Boolean) as { text: string; href: string; action: string }[];

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <div className="eyebrow">
            {phase === "before"
              ? t("Not started")
              : phase === "live"
                ? t("Running now")
                : t("Finished")}
          </div>
          <h1>{series.name}</h1>
          <p>
            {new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
              dateStyle: "full",
              timeZone: "Asia/Qatar",
            }).format(series.competitionDate)}{" "}
            · {series.venue}
          </p>
        </div>
        <div className="screen-head-actions">
          <Link href={at("board")} className="btn btn-secondary">
            {t("Live board")}
          </Link>
          <Link href={`/api/series/${series.slug}/export`} className="btn btn-secondary">
            {t("Export CSV")}
          </Link>
        </div>
      </div>

      {/* ── What needs doing ───────────────────────────────────────────────── */}
      {blocking.length > 0 ? (
        <ul className="todo-list">
          {blocking.map((item) => (
            <li key={item.href} className="todo">
              <span>{item.text}</span>
              <Link href={item.href} className="btn btn-secondary">
                {item.action}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="notice">
          <strong>{t("Ready.")}</strong>{" "}
          {t("Everyone registered is paid and placed, and the scoring is defined.")}
        </div>
      )}

      {/* ── The funnel ─────────────────────────────────────────────────────── */}
      <h2 className="section-title" style={{ marginTop: 28 }}>
        {t("Registrations")}
      </h2>
      <div className="stat-grid" style={{ marginTop: 10 }}>
        <Stat
          href={at("registrations")}
          label={t("Registered")}
          value={report.registered}
          note={`${report.people.total} ${t("people")}`}
        />
        <Stat
          href={`${at("registrations")}?payment=paid`}
          label={t("Paid")}
          value={report.paid}
          note={money(report.takingsMinor, report.currency)}
          bar={pct(report.paid, report.registered)}
        />
        <Stat
          href={`${at("registrations")}?payment=pending`}
          label={t("Awaiting payment")}
          value={report.pending}
          note={report.pending > 0 ? t("not on the board") : t("nothing outstanding")}
        />
        <Stat
          href={at("registrations")}
          label={t("Attended")}
          value={report.attended}
          note={`${pct(report.attended, report.paid)}% ${t("of paid")}`}
          bar={pct(report.attended, report.paid)}
        />
        <Stat
          href={at("studios")}
          label={t("BFT members")}
          value={report.people.members}
          note={`${report.people.nonMembers} ${t("non-members")}`}
          bar={pct(report.people.members, report.people.total)}
        />
      </div>

      {/* ── The day ────────────────────────────────────────────────────────── */}
      <h2 className="section-title" style={{ marginTop: 28 }}>
        {t("On the day")}
      </h2>
      <div className="stat-grid" style={{ marginTop: 10 }}>
        <Stat
          href={at("waves")}
          label={t("In a wave")}
          value={`${report.inWave}/${report.registered}`}
          bar={pct(report.inWave, report.registered)}
        />
        <Stat
          href={at("waves")}
          label={t("Waves complete")}
          value={`${waveSummary.complete}/${waveSummary.total}`}
          note={
            waveSummary.running > 0
              ? t("{n} on the floor now", { n: waveSummary.running })
              : t("nothing on the floor")
          }
          bar={pct(waveSummary.complete, waveSummary.total)}
        />
        <Stat
          href={at("scores")}
          label={t("Scored")}
          value={`${report.scored}/${report.paid}`}
          bar={pct(report.scored, report.paid)}
        />
        <Stat
          href={at("settings")}
          label={t("Studios may score")}
          value={series.studiosMayEnterScores ? t("Yes") : t("No")}
          note={
            series.studiosMayEnterScores
              ? t("entry only — corrections stay with BFT MENA")
              : t("BFT MENA only")
          }
        />
      </div>

      {/* ── Who is here ────────────────────────────────────────────────────── */}
      <h2 className="section-title" style={{ marginTop: 28 }}>
        {t("By studio")}
      </h2>
      <div className="table-scroll" style={{ marginTop: 10 }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t("Studio")}</th>
              <th style={{ textAlign: "end", width: 100 }}>{t("Teams")}</th>
              <th style={{ textAlign: "end", width: 110 }}>{t("Members")}</th>
            </tr>
          </thead>
          <tbody>
            {report.byStudio.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  {t("Nobody has registered under a studio yet.")}
                </td>
              </tr>
            ) : (
              report.byStudio.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td className="pd-num" style={{ textAlign: "end" }}>
                    {row.teams}
                  </td>
                  <td className="pd-num" style={{ textAlign: "end" }}>
                    {row.people}
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

function Stat({
  label,
  value,
  note,
  bar,
  href,
}: {
  label: string;
  value: string | number;
  note?: string;
  bar?: number;
  href?: string;
}) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note ? <span className="stat-note">{note}</span> : null}
      {bar !== undefined ? (
        <span className="stat-bar">
          <i style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} />
        </span>
      ) : null}
    </>
  );

  return href ? (
    <Link href={href} className="stat-card">
      {body}
    </Link>
  ) : (
    <div className="stat-card">{body}</div>
  );
}
