import Link from "next/link";

import type { SeriesScreenProps } from "@/screens/types";

import { getTranslator } from "@/lib/i18n/server";
import { requireSeries } from "@/lib/require-series";
import { requireConsoleAnyAccess, teamScope } from "@/lib/session";
import { getShirtSeats, getShirtSignupsWithoutTeam } from "@/lib/shirt-report";
import { SHIRT_SIZES } from "@/lib/shirt-sizes";
import { summariseShirts, type SizeCounts } from "@/lib/shirts";

export const dynamic = "force-dynamic";

/** One line of counts: a label, then every size smallest-first, then the total. */
function Row({ label, counts }: { label: string; counts: SizeCounts }) {
  return (
    <tr>
      <td>{label}</td>
      {SHIRT_SIZES.map((size) => (
        <td key={size} className="pd-num">
          {counts[size] || "—"}
        </td>
      ))}
      <td className="pd-num">
        <strong>{counts.total}</strong>
      </td>
    </tr>
  );
}

function Head({ first, total }: { first: string; total: string }) {
  return (
    <thead>
      <tr>
        <th>{first}</th>
        {SHIRT_SIZES.map((size) => (
          <th key={size}>{size}</th>
        ))}
        <th>{total}</th>
      </tr>
    </thead>
  );
}

/**
 * T-SHIRTS — how many of each size to order, and who wears which.
 *
 * One shirt per athlete on an entered team, the size resolved from where it
 * was last given (shirts.ts). The waiting list is its own column, not part
 * of the order; seats with no size are listed so somebody can ask. The CSV
 * has one line per athlete, for the printer and for the hand-out table.
 *
 * Open to `shirts.view` and to anyone who sees the entry list.
 */
export default async function ShirtsPage(props: SeriesScreenProps) {
  const user = await requireConsoleAnyAccess(["shirts.view", "registrations.view"]);
  const { t } = await getTranslator();
  const { series } = await requireSeries(props.params);

  const [seats, signups] = await Promise.all([
    getShirtSeats(series.id, teamScope(user)),
    getShirtSignupsWithoutTeam(series.id),
  ]);
  const summary = summariseShirts(seats);

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("T-shirts")}</h1>
          <p>{t("One shirt per athlete on an entered team. The waiting list is counted apart, not in the order.")}</p>
        </div>
        <div className="screen-head-actions">
          <Link href={`/api/series/${series.slug}/shirts`} className="btn btn-secondary" prefetch={false}>
            {t("Download CSV")}
          </Link>
        </div>
      </div>

      <h2 className="section-title">{t("To order")}</h2>
      <div className="table-scroll">
        <table className="table">
          <Head first="" total={t("Total")} />
          <tbody>
            <Row label={t("Entered teams")} counts={summary.field} />
            <Row label={t("Waiting list")} counts={summary.waitlisted} />
          </tbody>
        </table>
      </div>
      {summary.missing.length ? (
        <p className="notice-warn" style={{ marginTop: 8 }}>
          {t("{count} athletes have no size yet — see the list below.", { count: summary.missing.length })}
        </p>
      ) : null}

      <h2 className="section-title">{t("By gym")}</h2>
      <div className="table-scroll">
        <table className="table">
          <Head first={t("Gym")} total={t("Total")} />
          <tbody>
            {summary.byStudio.map((row) => (
              <Row key={row.studio} label={row.studio} counts={row.counts} />
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">{t("By category and level")}</h2>
      <div className="table-scroll">
        <table className="table">
          <Head first={t("Category")} total={t("Total")} />
          <tbody>
            {summary.byGroup.map((row) => (
              <Row key={`${row.category}-${row.division}`} label={`${t(row.category)} · ${t(row.division)}`} counts={row.counts} />
            ))}
          </tbody>
        </table>
      </div>

      {summary.missing.length ? (
        <>
          <h2 className="section-title">{t("No size given")}</h2>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Team")}</th>
                  <th>{t("Athlete")}</th>
                  <th>{t("Gym")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.missing.map((seat, index) => (
                  <tr key={`${seat.teamNumber}-${index}`}>
                    <td className="pd-num">
                      #{seat.teamNumber} {seat.teamName}
                    </td>
                    <td>{seat.athlete}</td>
                    <td>{seat.studio ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {signups.length ? (
        <>
          <h2 className="section-title">{t("Signed up, not on a team yet")}</h2>
          <p className="reg-sub">{t("Not counted in the order until they are on a team.")}</p>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Athlete")}</th>
                  <th>{t("Size")}</th>
                </tr>
              </thead>
              <tbody>
                {signups.map((row, index) => (
                  <tr key={index}>
                    <td>{row.user.name ?? row.user.email}</td>
                    <td>{row.shirtSize ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
