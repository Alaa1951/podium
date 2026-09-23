"use client";

import { Fragment, useState } from "react";

import { CrmIntakeComplete } from "@/components/admin/crm-intake-complete";
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
//
// AND NOW IT CAN BE FINISHED FROM HERE. Ringing somebody is not always enough:
// thirty people paid and then left the form, and they have no way back into it.
// "Complete" opens the missing answers under the row and writes them TO THE CRM
// — so the record stays in one place, and the row still clears itself by the
// ordinary route, on the next poll, as a team.
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

export function CrmIntakeList({
  rows,
  intro,
  seriesId,
  studioNames = [],
  canComplete = false,
}: {
  rows: CrmIntakeRow[];
  /** Needed only to complete a row; the list itself reads nothing from it. */
  seriesId?: string;
  /** Studios as PODIUM spells them, for the second athlete's membership. */
  studioNames?: string[];
  /**
   * May this viewer finish a registration?
   *
   * Off by default, so the list stays exactly the read-only work list it was
   * anywhere it is rendered without being told otherwise.
   */
  canComplete?: boolean;
  /**
   * The sentence under the heading.
   *
   * It defaults to the registrations screen's wording because that is where
   * this list was born and where the roster really is "the list above". On
   * the waiting-list screen the list above is the waiting teams, and the
   * default sentence would point somebody at the wrong table.
   */
  intro?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  /** What the last completion did. Lives here so it outlives the closing form. */
  const [done, setDone] = useState("");
  if (rows.length === 0) return null;
  const completable = canComplete && !!seriesId;

  return (
    <section style={{ marginTop: 20 }}>
      <div className="console-group-title">{t("Not a team yet")}</div>
      <p className="reg-sub" style={{ marginTop: 4 }}>
        {intro ??
          t(
            "{n} registrations in the CRM cannot be entered yet. Each one joins the list above by itself once its CRM form is finished.",
            { n: rows.length }
          )}
      </p>

      {done ? (
        <div className="notice" role="status" style={{ marginTop: 10 }}>
          {done}
        </div>
      ) : null}

      <div className="table-scroll" style={{ marginTop: 10 }}>
        <table className="table reg-table">
          <thead>
            <tr>
              <th>{t("Who")}</th>
              <th>{t("Contact")}</th>
              <th style={{ width: 170 }}>{t("In the CRM")}</th>
              <th style={{ width: 210 }}>{t("Still needed")}</th>
              <th style={{ width: 90 }}>{t("Waiting")}</th>
              {completable ? <th style={{ width: 110 }} /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
              <tr>
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
                  {completable ? (
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => setOpen(open === row.id ? null : row.id)}
                        aria-expanded={open === row.id}
                      >
                        {open === row.id ? t("Close") : t("Fill in what is missing")}
                      </button>
                    </td>
                  ) : null}
              </tr>
              {completable && open === row.id ? (
                <tr className="reg-detail">
                  <td colSpan={6}>
                    <CrmIntakeComplete
                      intakeId={row.id}
                      seriesId={seriesId!}
                      partnerName={row.partnerName}
                      teamName={row.teamName}
                      studioNames={studioNames}
                      onDone={(message) => {
                        setOpen(null);
                        if (message) setDone(message);
                      }}
                    />
                  </td>
                </tr>
              ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
