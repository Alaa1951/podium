"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useT } from "@/components/i18n/locale-provider";
import { sendAnnouncement } from "@/lib/actions/notifications";
import { useUnsavedChanges } from "@/components/app/mobile-runtime";
import { notifyNotificationsChanged } from "@/components/app/notification-events";

export function AnnouncementComposer({ admin, studioId, studios, readOnly }: {
  admin: boolean;
  studioId: string | null;
  studios: { id: string; name: string }[];
  readOnly: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [audience, setAudience] = useState(admin ? "all" : "studio");
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);

  return (
    <form className="card announcement-form" onInput={() => setDirty(true)} onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      const input = {
        title: String(fields.get("title") ?? ""), body: String(fields.get("body") ?? ""), audience,
        ...(audience === "role" ? { audienceRole: String(fields.get("audienceRole")) } : {}),
        ...(audience === "studio" ? { audienceStudioId: admin ? String(fields.get("audienceStudioId")) : studioId } : {}),
      };
      setMessage(null);
      startTransition(async () => {
        try {
          const result = await sendAnnouncement(input);
          setSuccess(result.ok);
          if (result.ok) {
            form.reset();
            setDirty(false);
            setMessage("Announcement sent.");
            notifyNotificationsChanged();
            router.refresh();
          } else {
            setMessage(result.error === "FORBIDDEN" ? "You cannot send to this audience." : result.error === "INVALID_INPUT" ? "Check the title, message and audience." : result.error === "TRY_LATER" ? "Too many attempts. Try again shortly." : "Something went wrong. Try again.");
          }
        } catch { setSuccess(false); setMessage("Something went wrong. Try again."); }
      });
    }}>
      <h2>{t("Send an announcement")}</h2>
      <p className="muted">{t("Send a message to the in-app inbox. No push notification or email is sent.")}</p>
      <fieldset disabled={pending || readOnly}>
        {admin ? <>
          <label htmlFor="announcement-audience">{t("Audience")}</label>
          <select id="announcement-audience" value={audience} onChange={(event) => setAudience(event.target.value)}>
            <option value="all">{t("Everyone")}</option><option value="role">{t("By role")}</option><option value="studio">{t("By studio")}</option>
          </select>
          {audience === "role" ? <><label htmlFor="announcement-role">{t("Role")}</label><select id="announcement-role" name="audienceRole"><option value="competitor">{t("Athlete")}</option><option value="studio">{t("Studio")}</option><option value="admin">{t("BFT MENA")}</option></select></> : null}
          {audience === "studio" ? <><label htmlFor="announcement-studio">{t("Studio")}</label><select id="announcement-studio" name="audienceStudioId" required><option value="">{t("Choose a studio")}</option>{studios.map((studio) => <option key={studio.id} value={studio.id}>{studio.name}</option>)}</select></> : null}
        </> : <p>{t("Audience: your studio only.")}</p>}
        <label htmlFor="announcement-title">{t("Title")}</label>
        <input id="announcement-title" name="title" required maxLength={160} dir="auto" />
        <label htmlFor="announcement-body">{t("Message")}</label>
        <textarea id="announcement-body" name="body" required maxLength={4000} rows={6} dir="auto" />
        <div className="mobile-action-bar"><button type="submit" className="btn btn-primary">{pending ? t("Sending…") : t("Send announcement")}</button></div>
      </fieldset>
      {readOnly ? <p className="notice">{t("You have read-only access.")}</p> : null}
      {message ? <p className="notice" role={success ? "status" : "alert"}>{t(message)}</p> : null}
    </form>
  );
}
