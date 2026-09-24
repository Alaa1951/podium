"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n/locale-provider";
import { requestWaveChange } from "@/lib/actions/wave-change-requests";
import type { TeamWaveChange } from "@/lib/wave-change-requests";
import { waveScheduleErrorMessage } from "@/lib/wave-schedule-messages";

const periods = { morning: "Morning", midday: "Midday", evening: "Evening" } as const;
const statuses = { pending: "Pending", approved: "Approved", rejected: "Rejected" } as const;

export function WaveChangeForm({ teamId, eligible, readOnly, requests }: {
  teamId: string; eligible: boolean; readOnly: boolean; requests: TeamWaveChange[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const openRequest = requests.find(request => request.status === "pending");

  function submit(form: FormData) {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await requestWaveChange({ teamId, preference: form.get("preference"), note: form.get("note") });
        if (!result.ok) { setMessage(t(waveScheduleErrorMessage(result.error))); router.refresh(); return; }
        setMessage(t("Your time change request was sent."));
        router.refresh();
      } catch { setMessage(t("Could not save. Check your connection and try again.")); }
    });
  }

  return <section className="form-block wave-change-panel">
    <h2 className="section-title">{t("Request change time")}</h2>
    <p className="reg-sub">{t("A time change applies to both athletes on your team. Your current wave stays assigned until approval.")}</p>
    {message && <p className="notice" role="status">{message}</p>}
    {openRequest ? <p className="notice">{t("Your team already has a pending time change request.")}</p> :
      !eligible ? <p className="reg-sub">{t("Time changes are available for teams assigned to a wave that has not started.")}</p> :
      <form action={submit} className="wave-change-form">
        <label><span className="field-label">{t("Preferred time")}</span>
          <select className="input" name="preference" required disabled={readOnly || pending} defaultValue="">
            <option value="" disabled>{t("Choose a preferred time")}</option>
            {Object.entries(periods).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </select>
        </label>
        <label><span className="field-label">{t("Note (optional)")}</span>
          <textarea className="input" name="note" maxLength={1000} rows={3} disabled={readOnly || pending} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={readOnly || pending}>{t("Send request")}</button>
      </form>}
    {requests.length > 0 && <div className="wave-request-history">
      <h3 className="section-title">{t("Time change history")}</h3>
      {requests.map(request => <article key={request.id}>
        <span className={`badge ${request.status === "approved" ? "badge-ok" : request.status === "pending" ? "badge-warn" : "badge-neutral"}`}>{t(statuses[request.status])}</span>
        <strong>{t(periods[request.preference])}</strong>
        {request.note && <p>{request.note}</p>}
        {request.status === "approved" && <p>{t("Approved move")}: {t("Wave")} {request.toWaveNumber} · {request.toStartTime}</p>}
        {request.rejectionReason && <p>{t("Reason")}: {request.rejectionReason}</p>}
      </article>)}
    </div>}
  </section>;
}
