"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n/locale-provider";
import { markNotificationsRead } from "@/lib/actions/notifications";
import { notifyNotificationsChanged } from "@/components/app/notification-events";

export function NotificationRead({ids,readOnly}:{ids:string[];readOnly:boolean}) {
  const t=useT(),router=useRouter();
  const [pending,startTransition]=useTransition();
  const [error,setError]=useState(false);
  return <>{error ? <p className="notice-error" role="alert">{t("Could not update notifications.")}</p> : null}<div className="mobile-action-bar"><button className="btn btn-primary" disabled={pending || readOnly || !ids.length} onClick={()=>startTransition(async()=>{try{const result=await markNotificationsRead(ids);if(!result.ok){setError(true);return;}setError(false);notifyNotificationsChanged();router.refresh();}catch{setError(true);}})}>{t(ids.length===1?"Mark as read":"Mark shown as read")}</button></div></>;
}
