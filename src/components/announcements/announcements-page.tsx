import { redirect } from "next/navigation";
import Link from "next/link";

import { AnnouncementComposer } from "@/components/announcements/announcement-composer";
import { PageShell } from "@/components/app/page-shell";
import { can } from "@/lib/access";
import { getTranslator } from "@/lib/i18n/server";
import { canComposeAnnouncements } from "@/lib/notification-access";
import { getNotificationUser } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { homeForUser } from "@/lib/session";

export async function AnnouncementsPage() {
  const user = await getNotificationUser();
  if (!user) redirect("/login");
  if (!canComposeAnnouncements(user)) redirect(await homeForUser(user));
  const { t, locale } = await getTranslator();
  const admin = user.role === "admin";
  const [studios, sent] = await Promise.all([
    admin ? prisma.studio.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.notification.findMany({
      where: admin ? {} : { createdBy: user.id, audience: "studio", audienceStudioId: user.studioId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50,
      select: { id: true, title: true, body: true, createdAt: true, audience: true, audienceRole: true, audienceStudio: { select: { name: true } }, creator: { select: { name: true, email: true } } },
    }),
  ]);
  return <PageShell title={t("Announcements")} blurb={t("Write an announcement for the people you support.")} actions={<Link className="btn btn-secondary" href={admin ? "/" : "/studio"}>{t("Back")}</Link>}>
    <AnnouncementComposer admin={admin} studioId={user.studioId} studios={studios} readOnly={!!user.viewAs || !can(user, "announcements.manage")} />
    <h2 style={{ marginTop: 28 }}>{t("Recent sent announcements")}</h2>
    {sent.length === 0 ? <p>{t("No announcements yet.")}</p> : <ul className="notification-list">{sent.map((item) => <li key={item.id} className="card notification-item">
      <h3 dir="auto">{item.title}</h3>
      <div className="muted">{item.audience === "all" ? t("Everyone") : item.audience === "studio" ? item.audienceStudio?.name : t(item.audienceRole === "admin" ? "BFT MENA" : item.audienceRole === "studio" ? "Studio" : "Competitor")} · {item.creator.name ?? item.creator.email}</div>
      <time dateTime={item.createdAt.toISOString()}>{new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(item.createdAt)}</time>
      <p dir="auto">{item.body}</p>
    </li>)}</ul>}
  </PageShell>;
}
