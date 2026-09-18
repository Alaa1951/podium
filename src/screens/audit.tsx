import { notFound } from "next/navigation";
import { DetailLink } from "@/components/app/detail-link";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * WHAT WAS DONE, AND BY WHOM.
 *
 * Every action that changes somebody else's data — a payment confirmed, a
 * score unlocked, a scoring factor edited, a studio added to a competition —
 * with the value before and after. A figure on a report can always be traced
 * back to the person who caused it.
 */
export default async function AuditPage(props: {searchParams:Promise<Record<string,string|string[]|undefined>>}, detailId?: string) {
  await requirePermission("audit.view");
  const searchParams = await props.searchParams;
  const { t } = await getTranslator();

  const page = Math.max(1, Number(searchParams.page) || 1);
  const perPage = 60;

  const [entries, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      where: detailId ? {id:detailId} : {},
      skip: detailId ? 0 : (page - 1) * perPage,
      take: perPage,
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.adminAuditLog.count(),
  ]);

  const pages = Math.max(1, Math.ceil(total / perPage));

  if (detailId && !entries.length) notFound();
  if(detailId){const entry=entries[0];return <div className="screen mobile-detail"><h1>{t("Audit log")}</h1><h2>{entry.targetLabel ?? entry.action}</h2><dl><dt>{t("Time")}</dt><dd>{entry.createdAt.toISOString()}</dd><dt>{t("Who")}</dt><dd>{entry.actor?.name ?? entry.actor?.email ?? "—"}</dd><dt>{t("Action")}</dt><dd>{entry.action}</dd><dt>{t("Detail")}</dt><dd>{entry.detail}</dd></dl></div>;}
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Audit log")}</h1>
          <p>{t("Every action that changed somebody else's data, and who took it.")}</p>
        </div>
      </div>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 160 }}>{t("Time")}</th>
              <th style={{ width: 190 }}>{t("Who")}</th>
              <th style={{ width: 200 }}>{t("Action")}</th>
              <th>{t("Detail")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  {t("Nothing recorded yet.")}
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="pd-num">
                    {entry.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td>{entry.actor?.name ?? entry.actor?.email ?? "—"}</td>
                  <td>
                    <code>{entry.action}</code>
                  </td>
                  <td>
                    <DetailLink href={`/audit/${entry.id}`} className="linkish"><strong>{entry.targetLabel ?? t("View details")}</strong></DetailLink>
                    {entry.targetLabel && entry.detail ? " · " : null}
                    {entry.detail}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
          <span className="reg-sub">
            {t("Page")} {page} / {pages} · {total} {t("entries")}
          </span>
          <div style={{ display: "flex", gap: 6, marginInlineStart: "auto" }}>
            {page > 1 ? (
              <a className="btn btn-secondary" href={`/audit?page=${page - 1}`}>
                {t("Newer")}
              </a>
            ) : null}
            {page < pages ? (
              <a className="btn btn-secondary" href={`/audit?page=${page + 1}`}>
                {t("Older")}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
