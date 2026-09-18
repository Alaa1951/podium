import { notFound } from "next/navigation";
import { PageShell } from "@/components/app/page-shell";
import { getScopedRoster } from "@/lib/queries";
import { requirePermission, requireRole } from "@/lib/session";
import { requireSeries } from "@/lib/require-series";
import { getStudioSeriesBySlug } from "@/lib/studio-queries";
import { getTranslator } from "@/lib/i18n/server";

export default async function CompetitorScreen(params: Promise<{ series: string; id: string; personId: string }>, studio: boolean) {
  const user = studio ? await requireRole("studio") : await requirePermission("competitors.view");
  const { series: slug, id, personId } = await params;
  const series = studio ? await getStudioSeriesBySlug(user,slug) : (await requireSeries(params)).series;
  if (!series) notFound();
  const [team] = await getScopedRoster(series.id, user, id);
  const person = team?.competitors.find((person) => person.id === personId);
  if (!team || !person) notFound();
  const { t } = await getTranslator();
  return <PageShell title={person.fullName}><article className="mobile-detail"><dl><dt>{t("Team")}</dt><dd>{team.name}</dd><dt>{t("Email")}</dt><dd>{person.email ?? "—"}</dd><dt>{t("Phone")}</dt><dd dir="ltr">{person.phone ?? "—"}</dd><dt>{t("Studio")}</dt><dd>{person.studioName ?? t("Non-member")}</dd><dt>{t("Category")}</dt><dd>{t(team.category)} · {t(team.division)}</dd></dl></article></PageShell>;
}
