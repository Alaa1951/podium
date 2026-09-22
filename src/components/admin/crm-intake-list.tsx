"use client";

import { useT } from "@/components/i18n/locale-provider";

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRATIONS THE CRM HAS NOT FINISHED.
//
// These people paid, or are in the pipeline, and are not teams yet — almost
// always because the registration form has no Category and no Division, which
// are the two things PODIUM cannot make up. They used to be skipped silently,
// which meant a third of everyone who registered was invisible to the people
// whose job is to ring them.
//
// So the list is a WORK LIST, and it carries the two things that make it one:
// what is missing, and how to reach them. It disappears by itself — each row
// goes the moment the CRM form is finished and the sync turns it into a team.
// ─────────────────────────────────────────────────────────────────────────────

export type CrmIntakeRow = {
  id: string;
  externalId: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  partnerName: string | null;
  teamName: string | null;
  stageName: string | null;
  missing: string;
  /**
   * Whole days this row has been waiting, WORKED OUT ON THE SERVER.
   *
   * Reading the clock while rendering is impure, and on a client component it
   * is also two different answers: the server renders one number and the
   * browser hydrates with another.
   */
  waitingDays: number;
};

export function CrmIntakeList({ rows }: { rows: CrmIntakeRow[] }) {
  const t = useT();
  if (rows.length === 0) return null;

  return (
    <section style={{ marginTop: 20 }}>
      <div className="console-group-title">{t("Not a team yet")}</div>
      <p className="reg-sub" style={{ marginTop: 4 }}>
        {t(
          "{n} registrations in the CRM cannot be entered yet. Each one joins the list above by itself once its CRM form is finished.",
          { n: rows.length }
        )}
      </p>

      <div className="table-scroll" style={{ marginTop: 10 }}>
        <table className="table reg-table">
          <thead>
            <tr>
              <th>{t("Who")}</th>
              <th>{t("Contact")}</th>
              <th style={{ width: 170 }}>{t("In the CRM")}</th>
              <th style={{ width: 210 }}>{t("Still needed")}</th>
              <th style={{ width: 90 }}>{t("Waiting")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                  <td>
                    <strong>{row.teamName ?? row.contactName}</strong>
                    <div className="reg-sub">
                      {row.teamName ? row.contactName : null}
                      {row.partnerName ? ` · ${row.partnerName}` : ""}
                      {/* Said plainly: a pair with one name is half a team,
                          and that is often the thing to ring about. */}
                      {!row.partnerName ? ` · ${t("no partner named")}` : ""}
                    </div>
                  </td>
                  <td>
                    <div className="reg-sub">{row.email ?? t("no email")}</div>
                    <div className="reg-sub pd-num">{row.phone ?? t("no phone")}</div>
                  </td>
                  <td className="reg-sub">{row.stageName ?? t("not in the pipeline")}</td>
                  <td>
                    <span className="badge badge-warn">{t(row.missing)}</span>
                  </td>
                  <td className="pd-num reg-sub">
                    {row.waitingDays >= 1 ? t("{n} days", { n: row.waitingDays }) : t("today")}
                  </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
