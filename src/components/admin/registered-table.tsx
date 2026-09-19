"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { setAttendance, setPayment } from "@/lib/actions/payments";
import { archiveTeam, restoreTeam } from "@/lib/actions/team-people";
import { RowPair } from "@/components/admin/registered-row";
import { DetailLink } from "@/components/app/detail-link";
import { useIsMobile } from "@/components/app/use-mobile";

// ─────────────────────────────────────────────────────────────────────────────
// THE REGISTERED LIST.
//
// Everyone who entered this round: who they are, how to reach them, whether
// their money landed, whether they turned up, and which wave they are in.
//
// Payment is confirmed from here — by the integration, or by hand when someone
// pays at the door — because only a paid registration reaches the board, and
// the person who takes the money is the person standing at this screen.
// ─────────────────────────────────────────────────────────────────────────────

export type RegisteredRow = {
  id: string;
  number: number;
  name: string;
  category: string;
  division: string;
  wave: number | null;
  paymentStatus: "pending" | "paid" | "refunded";
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
  }[];
};

export function RegisteredTable({
  rows,
  archivedRows = [],
  seriesId,
  canArchive,
  defaultAmount,
  defaultCurrency,
  detailId,
  readOnly = false,
}: {
  rows: RegisteredRow[];
  /** Withdrawn registrations — shown in their own strip, restorable. */
  archivedRows?: RegisteredRow[];
  seriesId: string;
  /** Archive actions exist only while the event is still scheduled. */
  canArchive: boolean;
  /** The event's usual entry fee, pre-filled when taking money at the door. */
  defaultAmount: string;
  defaultCurrency: string;
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

  function archive(row: RegisteredRow) {
    setMessage("");
    startTransition(async () => { const result = await archiveTeam(row.id); if(result.ok && detailId) router.replace(path.slice(0,path.lastIndexOf("/"))); else report(result); });
  }

  function restore(rowId: string) {
    setMessage("");
    startTransition(async () => report(await restoreTeam(seriesId, rowId)));
  }

  function confirm(row: RegisteredRow, amount: string, billingNumber: string, note: string) {
    if (readOnly) return;
    setMessage("");
    startTransition(async () => {
      const result = await setPayment({
        teamId: row.id,
        status: "paid",
        amount,
        currency: defaultCurrency,
        billingNumber,
        note,
      });
      if (!result.ok) {
        setMessage(t("Something went wrong. Try again."));
        return;
      }
      setExpanded(null);
      router.refresh();
    });
  }

  function reverse(row: RegisteredRow, status: "pending" | "refunded") {
    if (readOnly) return;
    setMessage("");
    startTransition(async () => {
      const result = await setPayment({ teamId: row.id, status });
      if (!result.ok) setMessage(t("Something went wrong. Try again."));
      else router.refresh();
    });
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
      <RowPair readOnly={readOnly} row={row} detailOnly open pending={pending} defaultAmount={defaultAmount} defaultCurrency={defaultCurrency} onToggle={() => {}} onConfirm={confirm} onReverse={reverse} onAttendance={attendance} onArchive={canArchive ? archive : undefined} />
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

      {mobile ? <div className="mobile-list">{rows.map((row) => <DetailLink key={row.id} href={`${path}/${row.id}`}><span className="pd-num">#{row.number}</span><div><strong>{row.name}</strong><small>{row.people.map((person) => person.fullName).join(" · ")}</small><small>{t(row.category)} · {t(row.division)} · {t("Wave")} {row.wave ?? "—"}</small></div><span className="badge">{t(row.paymentStatus)}</span><span aria-hidden="true">›</span></DetailLink>)}</div> : <div className="table-scroll" style={{ marginTop: 12 }}>
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
                defaultAmount={defaultAmount}
                defaultCurrency={defaultCurrency}
                onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                onConfirm={confirm}
                onReverse={reverse}
                onAttendance={attendance}
                onArchive={canArchive ? archive : undefined}
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
