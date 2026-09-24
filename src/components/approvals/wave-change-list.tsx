"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n/locale-provider";
import { approveWaveChange, rejectWaveChange } from "@/lib/actions/wave-change-requests";
import type { WaveChangeRow } from "@/lib/wave-change-requests";
import { waveScheduleErrorMessage } from "@/lib/wave-schedule-messages";

const periods = { morning: "Morning", midday: "Midday", evening: "Evening" } as const;
const statuses = { pending: "Pending", approved: "Approved", rejected: "Rejected" } as const;

export function WaveChangeList({ rows, canDecide }: { rows: WaveChangeRow[]; canDecide: boolean }) {
  const t = useT();
  return <div className="wave-change-list">{rows.length ? rows.map(row => <RequestCard key={row.id} row={row} canDecide={canDecide} />) :
    <p className="notice">{t("No time change requests match these filters.")}</p>}</div>;
}

function RequestCard({ row, canDecide }: { row: WaveChangeRow; canDecide: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const target = row.waves.find(wave => wave.id === targetId);
  const disabled = pending || !canDecide;
  function decide(approve: boolean) {
    setMessage("");
    startTransition(async () => {
      try {
        const result = approve && target && row.sourceWaveId && row.sourceWaveVersion
          ? await approveWaveChange({ requestId: row.id, targetWaveId: target.id, teamVersion: row.teamVersion,
            sourceWaveId: row.sourceWaveId, sourceWaveVersion: row.sourceWaveVersion, targetWaveVersion: target.version, targetOccupied: target.occupied })
          : !approve ? await rejectWaveChange({ requestId: row.id, reason }) : { ok: false, error: "INVALID_INPUT" };
        setMessage(result.ok ? t("Saved.") : t(waveScheduleErrorMessage("error" in result ? result.error : undefined)));
        router.refresh();
      } catch { setMessage(t("Could not save. Check your connection and try again.")); }
    });
  }
  return <article className="mobile-detail wave-request-card">
    <div className="wave-request-heading"><h2>#{row.teamNumber} · {row.teamName}</h2><span className="badge badge-neutral">{t(statuses[row.status])}</span></div>
    <p className="reg-sub">{row.seriesName} · {t(row.category)} · {t(row.division)}</p>
    <dl>
      <dt>{t("Requested by")}</dt><dd>{row.requester}</dd>
      <dt>{t("Current wave")}</dt><dd>{row.currentWaveNumber ?? "—"} · {row.currentStartTime ?? "—"}</dd>
      <dt>{t("Preferred time")}</dt><dd>{t(periods[row.preference])}</dd>
      {row.note && <><dt>{t("Note")}</dt><dd>{row.note}</dd></>}
      {row.status === "approved" && <><dt>{t("Approved move")}</dt><dd>{row.fromWaveNumber} ({row.fromStartTime}) → {row.toWaveNumber} ({row.toStartTime})</dd></>}
      {row.rejectionReason && <><dt>{t("Reason")}</dt><dd>{row.rejectionReason}</dd></>}
    </dl>
    {message && <p className="notice" role="status">{message}</p>}
    {row.status === "pending" && <div className="wave-request-actions">
      {!row.eligible && <p className="notice">{t("Time changes are available for teams assigned to a wave that has not started.")}</p>}
      <label><span className="field-label">{t("Move to wave")}</span>
        <select className="input" value={targetId} onChange={e => setTargetId(e.target.value)} disabled={disabled || !row.eligible}>
          <option value="">{t("Choose a wave")}</option>
          {row.waves.map(wave => <option key={wave.id} value={wave.id} disabled={wave.occupied >= wave.capacity}>
            {t("Wave")} {wave.number} · {wave.startTime} · {wave.occupied}/{wave.capacity} {t("Teams")}
          </option>)}
        </select>
      </label>
      <button type="button" className="btn btn-primary" disabled={disabled || !row.eligible || !target || target.occupied >= target.capacity} onClick={() => decide(true)}>{t("Approve & move")}</button>
      <label><span className="field-label">{t("Rejection reason")}</span><textarea className="input" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} rows={2} disabled={disabled} /></label>
      <button type="button" className="btn btn-secondary" disabled={disabled || !reason.trim()} onClick={() => decide(false)}>{t("Reject")}</button>
    </div>}
  </article>;
}
