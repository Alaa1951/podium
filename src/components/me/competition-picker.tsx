"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n/locale-provider";
export function CompetitionPicker({ series, selected }: { series: { id: string; name: string; status: string; date: string; isTraining: boolean }[]; selected: string }) {
  const router = useRouter(), t = useT();
  return <div className="card" style={{ marginBottom: 16 }}>
    <label htmlFor="my-competition">{t("Competition")}</label>
    <select id="my-competition" className="input" value={selected} onChange={e => router.push("/me?series=" + encodeURIComponent(e.target.value))}>
      {["live", "scheduled"].map(status => <optgroup key={status} label={t(status === "live" ? "Running" : "Upcoming")}>
        {series.filter(s => s.status === status).map(s => <option key={s.id} value={s.id}>{s.name}{s.isTraining ? " · " + t("Training") : ""} — {s.date}</option>)}
      </optgroup>)}
    </select>
    <p className="reg-sub">{series.find(s => s.id === selected)?.date}</p>
    <Link href="/me?series=all">{t("My competitions")}</Link>
  </div>;
}
