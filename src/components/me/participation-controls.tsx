"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n/locale-provider";
import { joinSeries, updateAthleteIdentity } from "@/lib/actions/participation";

export function JoinSeries({ seriesId }: { seriesId: string }) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return <div><button type="button" className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
    try {
      const result = await joinSeries(seriesId);
      if (!result.ok) { setError(t("This competition is not available to join.")); return; }
      router.push(`/me?series=${encodeURIComponent(seriesId)}`); router.refresh();
    } catch { setError(t("Could not save. Check your connection and try again.")); }
  })}>{t("Join competition")}</button>{error && <p role="alert">{error}</p>}</div>;
}

export function AthleteIdentity({ name, phone }: { name: string; phone: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  return <details className="card" style={{ marginTop: 18 }}><summary>{t("Personal details")}</summary>
    <p className="reg-sub">{t("These details belong to your account and appear in all your competitions.")}</p>
    <form style={{ display: "grid", gap: 12 }} onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      start(async () => { try {
        const result = await updateAthleteIdentity({ name: data.get("name"), phone: data.get("phone") });
        setMessage(t(result.ok ? "Profile updated." : "Check your name and phone number."));
        if (result.ok) router.refresh();
      } catch { setMessage(t("Could not save. Check your connection and try again.")); } });
    }}>
      <label>{t("Name")}<input className="input" name="name" defaultValue={name} required minLength={2} maxLength={120} /></label>
      <label>{t("Phone")}<input className="input" name="phone" type="tel" defaultValue={phone} required minLength={6} maxLength={30} /></label>
      <button className="btn btn-primary" disabled={pending}>{t("Save changes")}</button>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
