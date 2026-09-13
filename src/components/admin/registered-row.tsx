"use client";

import { useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { teamStatus, teamStatusLabel, teamStatusTone } from "@/lib/team-status";
import type { RegisteredRow } from "@/components/admin/registered-table";

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
}: {
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
}) {
  const t = useT();
  const [amount, setAmount] = useState(defaultAmount);
  const [billing, setBilling] = useState(row.billingNumber ?? "");
  const [note, setNote] = useState("");

  const paid = row.paymentStatus === "paid";
  const status = teamStatus(row);

  return (
    <>
      <tr data-unpaid={!paid || undefined}>
        <td className="pd-num muted">{row.number}</td>

        <td>
          <button type="button" className="linkish" onClick={onToggle} aria-expanded={open}>
            <strong>{row.name}</strong>
          </button>
          <div className="reg-sub">
            {row.source === "ghl" ? t("CRM form") : row.source === "manual" ? t("By hand") : t("Demo")}
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
            disabled={pending}
            onClick={() => onAttendance(row)}
          >
            {row.attended ? t("Checked in") : t("Check in")}
          </button>
        </td>
      </tr>

      {open ? (
        <tr className="reg-detail">
          <td colSpan={7}>
            <div className="reg-detail-grid">
              {/* ── Who they are, in full ──────────────────────────────── */}
              <div>
                <div className="console-group-title">{t("Contact")}</div>
                {row.people.map((person, index) => (
                  <div key={person.fullName} style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 600 }}>
                      {index + 1}. {person.fullName}
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
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={pending}
                        onClick={() => onReverse(row, "pending")}
                        style={{ height: 32, fontSize: 12 }}
                      >
                        {t("Mark unpaid")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={pending}
                        onClick={() => onReverse(row, "refunded")}
                        style={{ height: 32, fontSize: 12 }}
                      >
                        {t("Refund")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 8, display: "grid", gap: 8, maxWidth: 320 }}>
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
                      disabled={pending}
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
                    <dd>{paid ? t("yes") : t("no — unpaid")}</dd>
                  </div>
                </dl>

                {onArchive ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={pending}
                    onClick={() => onArchive(row)}
                    style={{ marginTop: 10, color: "var(--status-danger-text)", height: 32, fontSize: 12 }}
                  >
                    {t("Archive registration")}
                  </button>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
