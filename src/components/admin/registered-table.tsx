"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { setAttendance } from "@/lib/actions/payments";
import { archiveTeam, restoreTeam } from "@/lib/actions/team-people";
import { setWaitlist } from "@/lib/actions/waitlist";
import { AthleteAvatar } from "@/components/app/athlete-avatar";
import { RowPair } from "@/components/admin/registered-row";
import { DetailLink } from "@/components/app/detail-link";
import { useIsMobile } from "@/components/app/use-mobile";

// ─────────────────────────────────────────────────────────────────────────────
// THE REGISTERED LIST.
//
// Everyone who entered this round: who they are, how to reach them, whether
// their money landed, whether they turned up, and which wave they are in.
//
// PAYMENT IS SHOWN HERE, NEVER CHANGED HERE. The CRM owns the money, and the
// sync writes what it says: a button on this screen would be a second place to
// change a figure that has an owner elsewhere, and the next poll would quietly
// undo whoever pressed it.
// ─────────────────────────────────────────────────────────────────────────────

export type RegisteredRow = {
  id: string;
  number: number;
  name: string;
  category: string;
  division: string;
  wave: number | null;
  paymentStatus: "pending" | "paid" | "refunded";
  /**
   * On the waiting list: entered after registration closed, no place yet.
   *
   * The DATE, not a boolean, because this object is handed straight to
   * `teamStatus()` — which reads this field. It used to carry a
   * `waitlisted: boolean` for the buttons instead, and the status badge on
   * this very table then read undefined and called a paid waiting entry
   * REGISTERED.
   */
  waitlistedAt: Date | null;
  amount: string;
  currency: string;
  billingNumber: string | null;
  source: string;
  registeredAt: string;
  attended: boolean;
  submitted: boolean;
  people: {
    id?: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    studioName: string | null;
    /** Their portrait, or null for the shared default (athlete-photo.ts). */
    photoPath: string | null;
  }[];
};

export function RegisteredTable({
  rows,
  archivedRows = [],
  seriesId,
  canArchive,
  canWaitlist,
  detailId,
  readOnly = false,
}: {
  rows: RegisteredRow[];
  /** Withdrawn registrations — shown in their own strip, restorable. */
  archivedRows?: RegisteredRow[];
  seriesId: string;
  /** Archive actions exist only while the event is still scheduled. */
  canArchive: boolean;
  /** May this viewer hand out a place, or take one back? */
  canWaitlist: boolean;
  detailId?: string;
  readOnly?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const mobile = useIsMobile();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  function report(result: { ok: boolean; error?: string; message?: string }) {
    if (result.ok) {
      setMessage(result.message ?? t("Done."));
      router.refresh();
      return;
    }
    setMessage(
      result.error === "EVENT_RUNNING"
        ? t("The event is running — nothing can be removed from it right now.")
        : result.error === "EVENT_FINISHED"
          ? t("The event is finished — its registrations are part of the record.")
          : t("Something went wrong. Try again.")
    );
  }

  // Handing out a place, or taking one back. Separate from the payment
  // actions beside it on purpose: money and a place are different things, and
  // whoever confirms one is not thereby deciding the other.
  function waitlist(row: RegisteredRow, waiting: boolean) {
    setMessage("");
    startTransition(async () => {
      report(await setWaitlist({ teamId: row.id, waiting }));
      router.refresh();
    });
  }

  function archive(row: RegisteredRow) {
    setMessage("");
    startTransition(async () => { const result = await archiveTeam(row.id); if(result.ok && detailId) router.replace(path.slice(0,path.lastIndexOf("/"))); else report(result); });
  }

  function restore(rowId: string) {
    setMessage("");
    startTransition(async () => report(await restoreTeam(seriesId, rowId)));
  }

  function attendance(row: RegisteredRow) {
    if (readOnly) return;
    startTransition(async () => {
      const result = await setAttendance({ teamId: row.id, attended: !row.attended });
      if (!result.ok) setMessage(t("Something went wrong. Try again."));
      else router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="notice" style={{ marginTop: 14 }}>
        <strong>{t("Nobody matches.")}</strong>{" "}
        {t("Clear the search, or add a registration by hand.")}
      </div>
    );
  }

  if (detailId) {
    const row = rows.find((row) => row.id === detailId)!;
    return <div className="mobile-detail">
      <h1>{row.name}</h1>
      {message ? <div className="notice" role="status">{message}</div> : null}
      <p>{t(row.category)} · {t(row.division)}</p>
      {!readOnly ? <DetailLink href={`${path}/edit`} className="btn btn-secondary">{t("Edit")}</DetailLink> : null}
      <RowPair readOnly={readOnly} row={row} detailOnly open pending={pending} onToggle={() => {}} onAttendance={attendance} onArchive={canArchive ? archive : undefined} onWaitlist={canWaitlist ? waitlist : undefined} />
      <button type="button" className="btn btn-secondary mobile-action-bar" disabled={pending || readOnly} onClick={() => attendance(row)}>{row.attended ? t("Checked in") : t("Check in")}</button>
    </div>;
  }

  return (
    <>
      {message ? (
        <div className="notice" role="status" style={{ marginTop: 12 }}>
          {message}
        </div>
      ) : null}

      {mobile ? <div className="mobile-list">{rows.map((row) => <DetailLink key={row.id} href={`${path}/${row.id}`}><span className="pd-num">#{row.number}</span><span className="mobile-list-faces">{row.people.map((person) => <AthleteAvatar key={person.fullName} photoPath={person.photoPath} name={person.fullName} size={28} />)}</span><div><strong>{row.name}</strong><small>{row.people.map((person) => person.fullName).join(" · ")}</small><small>{t(row.category)} · {t(row.division)} · {t("Wave")} {row.wave ?? "—"}</small></div><span className="badge">{t(row.paymentStatus)}</span><span aria-hidden="true">›</span></DetailLink>)}</div> : <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="table reg-table">
          <thead>
            <tr>
              <th style={{ width: 56 }}>#</th>
              <th>{t("Team")}</th>
              <th>{t("Athletes")}</th>
              <th style={{ width: 120 }}>{t("Bracket")}</th>
              <th style={{ width: 66 }}>{t("Wave")}</th>
              <th style={{ width: 150 }}>{t("Status")}</th>
              <th style={{ width: 96 }}>{t("Attended")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <RowPair
                readOnly={readOnly}
                key={row.id}
                row={row}
                open={expanded === row.id}
                pending={pending}
                onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                onAttendance={attendance}
                onArchive={canArchive ? archive : undefined} onWaitlist={canWaitlist ? waitlist : undefined}
              />
            ))}
          </tbody>
        </table>
      </div>}

      {archivedRows.length > 0 ? (
        <>
          <button
            type="button"
            className="linkish"
            style={{ marginTop: 10, fontSize: 13 }}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived
              ? t("Hide archived")
              : t("Show archived ({n})", { n: archivedRows.length })}
          </button>

          {showArchived ? (
            <div className="table-scroll" style={{ marginTop: 10 }}>
              <table className="table reg-table">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>#</th>
                    <th>{t("Team")}</th>
                    <th>{t("Athletes")}</th>
                    <th style={{ width: 120 }}>{t("Bracket")}</th>
                    <th style={{ width: 150 }}>{t("Status")}</th>
                    <th style={{ width: 110 }}>{t("Archived")}</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedRows.map((row) => (
                    <tr key={row.id}>
                      <td className="pd-num muted">{row.number}</td>
                      <td>
                        <strong>{row.name}</strong>
                        <div className="reg-sub">{t("Withdrawn — hidden from every board")}</div>
                      </td>
                      <td>
                        {row.people.map((person) => (
                          <div key={person.fullName} className="reg-person">
                            <AthleteAvatar photoPath={person.photoPath} name={person.fullName} />
                            <span>{person.fullName}</span>
                          </div>
                        ))}
                      </td>
                      <td>
                        {t(row.category)} {t(row.division)}
                      </td>
                      <td>
                        <span className="badge badge-neutral">{t("Archived")}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={pending}
                          onClick={() => restore(row.id)}
                        >
                          {t("Restore")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
