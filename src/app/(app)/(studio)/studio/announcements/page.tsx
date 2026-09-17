import { AnnouncementsPage } from "@/components/announcements/announcements-page";
import { PlainHeader } from "@/components/app/plain-header";
import { getTranslator } from "@/lib/i18n/server";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function StudioAnnouncements() {
  const user = await requireRole("studio");
  const { t } = await getTranslator();
  return <><PlainHeader roleLabel={user.name ?? t("Studio")} /><AnnouncementsPage /></>;
}
