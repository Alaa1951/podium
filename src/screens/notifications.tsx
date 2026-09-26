import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { DetailLink } from "@/components/app/detail-link";
import { PlainHeader } from "@/components/app/plain-header";
import { NotificationRead } from "@/components/app/notification-read";
import { getTranslator } from "@/lib/i18n/server";
import { getNotificationUser, listNotifications } from "@/lib/notifications";
import { notificationScope } from "@/lib/notification-access";
import { prisma } from "@/lib/prisma";

export default async function NotificationsScreen(detailId?:string,cursor?:string) {
  const user=await getNotificationUser();if(!user)redirect("/login");
  const {t,locale}=await getTranslator();
  const format=(value:string)=>new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Qatar"}).format(new Date(value));
  if(detailId){
    const item=await prisma.notification.findFirst({where:{AND:[notificationScope(user),{id:detailId}]},include:{reads:{where:{userId:user.id},select:{userId:true}}}});
    if(!item)notFound();
    return <div className="screen"><PlainHeader roleLabel={t("Notifications")} /><article className="mobile-detail"><h1 dir="auto">{item.title}</h1><time dateTime={item.createdAt.toISOString()}>{format(item.createdAt.toISOString())}</time><p dir="auto" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{item.body}</p><NotificationRead ids={item.reads.length?[]:[item.id]} readOnly={!!user.viewAs} /></article></div>;
  }
  const feed=await listNotifications(user,cursor);if(!feed)notFound();
  return <div className="screen"><PlainHeader roleLabel={t("Notifications")} /><h1>{t("Notifications")}</h1>{feed.readOnly?<p className="notice">{t("Preview is read-only.")}</p>:null}<p>{t("{count} unread",{count:feed.unreadCount})}</p><div className="mobile-list">{feed.items.map(item=><DetailLink key={item.id} href={`/notifications/${item.id}`}><div><strong dir="auto">{item.title}</strong><small>{format(item.createdAt)}</small><small>{t(item.read?"Read":"Unread")}</small></div><span aria-hidden="true">›</span></DetailLink>)}</div>{!feed.items.length?<p>{t("No announcements yet.")}</p>:null}{feed.nextCursor?<Link className="btn btn-secondary" href={`/notifications?cursor=${encodeURIComponent(feed.nextCursor)}`}>{t("Load more")}</Link>:null}<NotificationRead ids={feed.items.filter(item=>!item.read).map(item=>item.id)} readOnly={feed.readOnly} /></div>;
}
