"use client";

import { AthleteAvatar } from "@/components/app/athlete-avatar";
import { useT } from "@/components/i18n/locale-provider";
import { teamStatus, teamStatusLabel, teamStatusTone } from "@/lib/team-status";
import type { RegisteredRow } from "@/components/admin/registered-table";
import { usePathname } from "next/navigation";
import { DetailLink } from "@/components/app/detail-link";

// One registration: the row, and the panel that opens under it with the
// contact details and what the CRM says about the money.

export function RowPair({
  row,
  open,
  pending,
  onToggle,
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
  onToggle: () => void;
  onAttendance: (row: RegisteredRow) => void;
  /** Offered only while the event is scheduled — a withdrawal, archived not deleted. */
  onArchive?: (row: RegisteredRow) => void;
  /** Handing out a place, or taking one back. Needs registrations.waitlist. */
  onWaitlist?: (row: RegisteredRow, waiting: boolean) => void;
}) {
  const t = useT();

  const paid = row.paymentStatus === "paid";
  const status = teamStatus(row);
  const path = usePathname();

  const details = (
<div className="reg-detail-grid">
              {/* ── Who they are, in full ──────────────────────────────── */}
              <div>
                <div className="console-group-title">{t("Contact")}</div>
                {row.people.map((person, index) => (
                  <div key={person.fullName} style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
                    <AthleteAvatar photoPath={person.photoPath} name={person.fullName} size={44} />
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

                {/* PAYMENT IS READ-ONLY HERE, and that is the design.
                    The CRM owns the money: it is where registrations arrive
                    and where payment is taken, and the sync writes what it
                    says. A button here would be a second place to change a
                    figure that has an owner elsewhere — and the next poll
                    would quietly undo whoever pressed it, on the morning of
                    a competition, with nothing on screen to explain why. */}
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
                  </div>
                ) : (
                  <p style={{ marginTop: 8 }}>{t("Awaiting payment")}</p>
                )}
                <p className="reg-sub" style={{ marginTop: 10 }}>
                  {t("Payment is recorded in the CRM and arrives here on the next sync.")}
                </p>
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
              <AthleteAvatar photoPath={person.photoPath} name={person.fullName} />
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
