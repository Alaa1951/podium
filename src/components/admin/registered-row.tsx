"use client";

import { useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { teamStatus, teamStatusLabel, teamStatusTone } from "@/lib/team-status";
import type { RegisteredRow } from "@/components/admin/registered-table";
import { usePathname } from "next/navigation";
import { DetailLink } from "@/components/app/detail-link";
import { useUnsavedChanges } from "@/components/app/mobile-runtime";

// One registration: the row, and the panel that opens under it with the
// contact details and the payment action.

export function RowPair({
  row,
  open,
  pending,
  defaultAmount,
  defaultCurrency,
  onToggle,
  onConfirm,
  onReverse,
  onAttendance,
  onArchive,
  onWaitlist,
  detailOnly = false,
  readOnly = false,
}: {
  detailOnly?: boolean;
  readOnly?: boolean;
  row: RegisteredRow;
  open: boolean;
  pending: boolean;
  defaultAmount: string;
  defaultCurrency: string;
  onToggle: () => void;
  onConfirm: (row: RegisteredRow, amount: string, billing: string, note: string) => void;
  onReverse: (row: RegisteredRow, status: "pending" | "refunded") => void;
  onAttendance: (row: RegisteredRow) => void;
  /** Offered only while the event is scheduled — a withdrawal, archived not deleted. */
  onArchive?: (row: RegisteredRow) => void;
  /** Handing out a place, or taking one back. Needs registrations.waitlist. */
  onWaitlist?: (row: RegisteredRow, waiting: boolean) => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState(defaultAmount);
  const [billing, setBilling] = useState(row.billingNumber ?? "");
  const [note, setNote] = useState("");

  const paid = row.paymentStatus === "paid";
  const status = teamStatus(row);
  const path = usePathname();
  useUnsavedChanges(!readOnly && !paid && (amount !== defaultAmount || billing !== (row.billingNumber ?? "") || note !== ""));

  const details = (
<div className="reg-detail-grid">
              {/* ── Who they are, in full ──────────────────────────────── */}
              <div>
                <div className="console-group-title">{t("Contact")}</div>
                {row.people.map((person, index) => (
                  <div key={person.fullName} style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 600 }}>
                      {detailOnly && person.id ? <DetailLink href={`${path}/people/${person.id}`} className="linkish">{index + 1}. {person.fullName}</DetailLink> : <>{index + 1}. {person.fullName}</>}
                    </div>
                    <div className="reg-sub">{person.email ?? t("no email")}</div>
                    <div className="reg-sub pd-num">{person.phone ?? t("no phone")}</div>
                    <div className="reg-sub">
                      {person.studioName
                        ? `${t("Member of")} ${person.studioName}`
                        : t("Not a BFT member")}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── The money ──────────────────────────────────────────── */}
              <div>
                <div className="console-group-title">{t("Payment")}</div>

                {paid ? (
                  <div style={{ marginTop: 8 }}>
                    <div className="pd-num" style={{ fontSize: 20, fontWeight: 600 }}>
                      {row.amount} {row.currency}
                    </div>
                    <div className="reg-sub">
                      {row.billingNumber
                        ? `${t("Invoice")} ${row.billingNumber}`
                        : t("No billing number recorded")}
                    </div>
                    <div hidden={readOnly} style={{ display: readOnly ? "none" : "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={pending || readOnly}
                        onClick={() => onReverse(row, "pending")}
                        style={{ height: 32, fontSize: 12 }}
                      >
                        {t("Mark unpaid")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={pending || readOnly}
                        onClick={() => onReverse(row, "refunded")}
                        style={{ height: 32, fontSize: 12 }}
                      >
                        {t("Refund")}
                      </button>
                    </div>
                  </div>
                ) : (
                  readOnly ? <p>{t("Awaiting payment")}</p> : <div style={{ marginTop: 8, display: "grid", gap: 8, maxWidth: 320 }}>
                    <p className="reg-sub" style={{ margin: 0 }}>
                      {t(
                        "Confirming payment puts this team on the board. Record what was actually taken."
                      )}
                    </p>
                    <label>
                      <span className="field-label">
                        {t("Amount")} ({defaultCurrency})
                      </span>
                      <input
                        className="input pd-num"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                    <label>
                      <span className="field-label">{t("Invoice number")}</span>
                      <input
                        className="input"
                        value={billing}
                        onChange={(e) => setBilling(e.target.value)}
                        placeholder={t("optional")}
                      />
                    </label>
                    <label>
                      <span className="field-label">{t("Note")}</span>
                      <input
                        className="input"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={t("cash at the door, card, transfer…")}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={pending || readOnly}
                      onClick={() => onConfirm(row, amount, billing, note)}
                    >
                      {t("Confirm payment")}
                    </button>
                  </div>
                )}
              </div>

              {/* ── Where they are in the day ──────────────────────────── */}
              <div>
                <div className="console-group-title">{t("Progress")}</div>
                <dl className="reg-facts">
                  <div>
                    <dt>{t("Wave")}</dt>
                    <dd className="pd-num">{row.wave ?? t("unassigned")}</dd>
                  </div>
                  <div>
                    <dt>{t("Attended")}</dt>
                    <dd>{row.attended ? t("yes") : t("no")}</dd>
                  </div>
                  <div>
                    <dt>{t("Score")}</dt>
                    <dd>{row.submitted ? t("submitted") : t("not yet")}</dd>
                  </div>
                  <div>
                    <dt>{t("On the board")}</dt>
                    {/* Payment is no longer the whole answer: a waitlisted
                        entry can be fully paid and is still not competing. */}
                    <dd>
                      {row.waitlistedAt
                        ? t("no — waiting list")
                        : paid
                          ? t("yes")
                          : t("no — unpaid")}
                    </dd>
                  </div>
                </dl>

                {/* A place, given or taken back. Said in full, because a
                    waiting list is the one thing people ask staff about. */}
                {onWaitlist ? (
                  <div style={{ marginTop: 10 }}>
                    {row.waitlistedAt ? (
                      <>
                        <p className="reg-sub" style={{ margin: "0 0 6px" }}>
                          {t("On the waiting list since registration closed. Admitting them gives them a place; it does not confirm any payment.")}
                        </p>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={pending}
                          onClick={() => onWaitlist(row, false)}
                          style={{ height: 32, fontSize: 12 }}
                        >
                          {t("Admit from the waiting list")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={pending || row.submitted}
                        onClick={() => onWaitlist(row, true)}
                        style={{ height: 32, fontSize: 12 }}
                      >
                        {t("Move to the waiting list")}
                      </button>
                    )}
                  </div>
                ) : null}

                {onArchive ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={pending || readOnly}
                    onClick={() => onArchive(row)}
                    style={{ marginTop: 10, color: "var(--status-danger-text)", height: 32, fontSize: 12 }}
                  >
                    {t("Archive registration")}
                  </button>
                ) : null}
              </div>
            </div>
  );
  if (detailOnly) return <section className="mobile-detail">{details}</section>;

  return (
    <>
      <tr data-unpaid={!paid || undefined}>
        <td className="pd-num muted">{row.number}</td>

        <td>
          <button type="button" className="linkish" onClick={onToggle} aria-expanded={open}>
            <strong>{row.name}</strong>
          </button>
          <div className="reg-sub">
            {/* Named in full rather than falling through to "Demo" — a pair
                who signed themselves up is the opposite of demo data, and
                staff reconciling entries read this column. */}
            {row.source === "ghl"
              ? t("CRM form")
              : row.source === "manual"
                ? t("By hand")
                : row.source === "signup"
                  ? t("Signed up")
                  : t("Demo")}
            {" · "}
            {row.registeredAt}
          </div>
        </td>

        <td>
          {row.people.map((person) => (
            <div key={person.fullName} className="reg-person">
              <span>{person.fullName}</span>
              <span className={person.studioName ? "badge badge-cyan" : "badge badge-neutral"}>
                {person.studioName ?? t("Non-member")}
              </span>
            </div>
          ))}
        </td>

        <td>
          {t(row.category)} {t(row.division)}
        </td>

        <td className="pd-num">{row.wave ?? "—"}</td>

        {/* One word for where this entry stands, as the manual's own dashboard
            shows it — with the money underneath, which is this screen's job and
            not the studio's. */}
        <td>
          <span className={`badge ${teamStatusTone(status)}`}>{t(teamStatusLabel(status))}</span>
          <div className="reg-sub pd-num">
            {paid ? `${row.amount} ${row.currency}` : t("not on the board")}
            {row.billingNumber ? ` · ${row.billingNumber}` : ""}
          </div>
        </td>

        <td>
          <button
            type="button"
            className={row.attended ? "chip-sm" : "chip-sm"}
            data-active={row.attended || undefined}
            disabled={pending || readOnly}
            onClick={() => onAttendance(row)}
          >
            {row.attended ? t("Checked in") : t("Check in")}
          </button>
        </td>
      </tr>

      {open ? (
        <tr className="reg-detail">
          <td colSpan={7}>
            {details}
          </td>
        </tr>
      ) : null}
    </>
  );
}
