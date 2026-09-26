import { DetailLink } from "@/components/app/detail-link";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { AnnouncementComposer } from "@/components/announcements/announcement-composer";
import { PageShell } from "@/components/app/page-shell";
import { can, isBft } from "@/lib/access";
import { getTranslator } from "@/lib/i18n/server";
import { canComposeAnnouncements } from "@/lib/notification-access";
import { getNotificationUser } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { homeForUser } from "@/lib/session";

export async function AnnouncementsPage(detailId?: string, compose = false) {
  const user = await getNotificationUser();
  if (!user) redirect("/login");
  if (!canComposeAnnouncements(user)) redirect(await homeForUser(user));
  const { t, locale } = await getTranslator();
  const admin = isBft(user);
  const [studios, sent] = await Promise.all([
    admin ? prisma.studio.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.notification.findMany({
      where: { ...(detailId ? {id:detailId} : {}), ...(admin ? {} : { createdBy: user.id, audience: "studio", audienceStudioId: user.studioId }) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50,
      select: { id: true, title: true, body: true, createdAt: true, audience: true, audienceRole: true, audienceStudio: { select: { name: true } }, creator: { select: { name: true, email: true } } },
    }),
  ]);
  if (detailId && !sent.length) notFound();
  const base = admin ? "/announcements" : "/studio/announcements";
  if (detailId) {const item = sent[0]; return <PageShell title={item.title}><time dateTime={item.createdAt.toISOString()}>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Qatar"}).format(item.createdAt)}</time><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}} dir="auto">{item.body}</p></PageShell>;}
  return <PageShell title={t("Announcements")} blurb={t("Write an announcement for the people you support.")} actions={<Link className="btn btn-secondary desktop-only" href={admin ? "/" : "/studio"}>{t("Back")}</Link>}>
    {compose ? <AnnouncementComposer admin={admin} studioId={user.studioId} studios={studios} readOnly={!!user.viewAs || !can(user, "announcements.send")} /> : <><Link href={`${base}/new`} className="btn btn-primary mobile-only">{t("Send an announcement")}</Link><div className="desktop-only"><AnnouncementComposer admin={admin} studioId={user.studioId} studios={studios} readOnly={!!user.viewAs || !can(user, "announcements.send")} /></div></>}
    {!compose ? <><h2 style={{ marginTop: 28 }}>{t("Recent sent announcements")}</h2>
    {sent.length === 0 ? <p>{t("No announcements yet.")}</p> : <ul className="notification-list">{sent.map((item) => <li key={item.id} className="card notification-item">
      <DetailLink href={`${base}/${item.id}`} className="linkish"><h3 dir="auto">{item.title}</h3></DetailLink>
      <div className="muted">{item.audience === "all" ? t("Everyone") : item.audience === "studio" ? item.audienceStudio?.name : t(item.audienceRole === "admin" ? "BFT MENA" : item.audienceRole === "studio" ? "Studio" : "Athlete")} · {item.creator.name ?? item.creator.email}</div>
      <time dateTime={item.createdAt.toISOString()}>{new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Qatar" }).format(item.createdAt)}</time>
      <p dir="auto">{item.body}</p>
    </li>)}</ul>}</> : null}
  </PageShell>;
}
