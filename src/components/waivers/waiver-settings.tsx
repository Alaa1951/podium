import Link from "next/link";

import { AttachWaiverButton } from "@/components/waivers/waiver-admin";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { formatQatarDateTime, formatQatarDayKey } from "@/lib/qatar-time";
import { WAIVER_DOCUMENTS } from "@/lib/waivers/document";
import { waiverSatisfied } from "@/lib/waivers/status";
import { seatsOf, waiverStates } from "@/lib/waivers/waiver-db";

/**
 * SETTINGS → WAIVER, for BFT MENA (`waivers.manage`): which version athletes
 * must sign here, how many have, the documents that can be required — each
 * naming the event it was written for, since a waiver is attached to one
 * competition on purpose and applies nowhere else — and every signed
 * record, with its receipt.
 */
export async function WaiverSettings({ series }: { series: { id: string; status: string; competitionDate: Date } }) {
  const { t } = await getTranslator();
  const [releases, teams] = await Promise.all([
    prisma.waiverRelease.findMany({
      where: { seriesId: series.id },
      orderBy: { version: "desc" },
      select: { id: true, version: true, documentKey: true, status: true, activatedAt: true, retiredAt: true, _count: { select: { acceptances: true } } },
    }),
    prisma.team.findMany({ where: { seriesId: series.id, archivedAt: null, waitlistedAt: null }, select: { id: true, number: true } }),
  ]);
  const active = releases.find((one) => one.status === "active") ?? null;
  const seats = await seatsOf(prisma, teams.map((team) => team.id));
  const states = await waiverStates(prisma, series.id, seats);
  const signed = seats.filter((seat) => waiverSatisfied(states.get(seat.competitorId)!)).length;
  const records = active
    ? await prisma.waiverAcceptance.findMany({ where: { seriesId: series.id }, orderBy: { acceptedAt: "desc" }, take: 500, select: { id: true, userId: true, teamId: true, language: true, acceptedAt: true, releaseId: true } })
    : [];
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(records.map((one) => one.userId))] } }, select: { id: true, name: true, email: true } });
  const numbers = new Map(teams.map((team) => [team.id, team.number]));
  const version = new Map(releases.map((one) => [one.id, one.version]));
  const finished = series.status === "final";

  return (
    <section id="waiver" className="card waiver-settings" style={{ marginTop: 34 }} data-testid="waiver-settings">
      <h2 className="section-title" style={{ margin: 0 }}>{t("Waiver")}</h2>
      <p className="reg-sub" style={{ margin: "4px 0 12px", maxWidth: "70ch" }}>
        {t("Every athlete signs the competition's waiver themselves, in English or Arabic, before the entrance lets them in. Nobody can sign for them. Only a document attached here applies to this competition.")}
      </p>

      {active ? (
        <div className="notice" data-testid="waiver-active">
          <strong>{t("Version {version} is required", { version: active.version })}</strong> · {active.documentKey} · {t("since {date}", { date: formatQatarDateTime(active.activatedAt) })}
          <div className="reg-sub pd-num">{t("{signed} of {total} athletes in the field have signed", { signed, total: seats.length })}</div>
        </div>
      ) : (
        <div className="notice">{t("No waiver is required for this competition.")}</div>
      )}

      <div className="waiver-documents">
        {WAIVER_DOCUMENTS.map((doc) => {
          const key = `${doc.key}@${doc.version}`;
          const isActive = active?.documentKey === key;
          const otherDay = doc.event.date !== formatQatarDayKey(series.competitionDate);
          return (
            <div key={key} className="waiver-document-choice">
              <strong>{doc.event.name}</strong> · {t("document version {version}", { version: doc.version })}
              <div className="reg-sub">{doc.event.date} · {doc.event.venue}</div>
              {/* A sentence, so a notice that wraps — a badge never wraps, and pushed a phone sideways. */}
              {otherDay ? <div className="notice notice-warn" style={{ margin: 0 }}>{t("Written for {date}; this competition is on {day}. Attach it only if it is the right event.", { date: doc.event.date, day: formatQatarDayKey(series.competitionDate) })}</div> : null}
              {isActive ? <span className="badge badge-ok">{t("Required now")}</span> : finished ? null : (
                <AttachWaiverButton
                  seriesId={series.id}
                  documentKey={doc.key}
                  version={doc.version}
                  label={active ? t("Require this version instead") : t("Require this waiver")}
                  confirm={active
                    ? t("Require this version? Signatures of the current version are kept, and every athlete must sign the new one before entry.")
                    : t("Require this waiver for this competition? From now on, every athlete must sign it before entry.")}
                />
              )}
            </div>
          );
        })}
      </div>

      {releases.length > 1 ? (
        <p className="reg-sub">{t("Earlier versions")}: {releases.filter((one) => one.status === "retired").map((one) => t("version {version} ({count} signatures kept)", { version: one.version, count: one._count.acceptances })).join(" · ")}</p>
      ) : null}

      {records.length ? (
        <details className="waiver-records">
          <summary>{t("Signed records ({count})", { count: records.length })}</summary>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>{t("Athlete")}</th><th>{t("Team")}</th><th>{t("Version")}</th><th>{t("Language")}</th><th>{t("Signed at")}</th><th /></tr>
              </thead>
              <tbody>
                {records.map((one) => {
                  const who = users.find((user) => user.id === one.userId);
                  return (
                    <tr key={one.id}>
                      <td>{who?.name ?? "—"}<div className="reg-sub">{who?.email}</div></td>
                      <td className="pd-num">{numbers.has(one.teamId) ? `#${numbers.get(one.teamId)}` : "—"}</td>
                      <td className="pd-num">{version.get(one.releaseId)}</td>
                      <td>{one.language === "ar" ? "العربية" : "English"}</td>
                      <td className="pd-num">{formatQatarDateTime(one.acceptedAt)}</td>
                      <td><Link href={`/waivers/receipt/${one.id}`}>{t("Receipt")}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
