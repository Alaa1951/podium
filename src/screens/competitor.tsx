import { notFound } from "next/navigation";
import { PageShell } from "@/components/app/page-shell";
import { SwapMemberPanel } from "@/components/admin/swap-member-panel";
import { can } from "@/lib/access";
import { getScopedRoster } from "@/lib/queries";
import { requireAccess, requireRole } from "@/lib/session";
import { requireSeries } from "@/lib/require-series";
import { getStudioSeriesBySlug } from "@/lib/studio-queries";
import { listSwapCandidates, readSwapSeat } from "@/lib/team-swap";
import { getTranslator } from "@/lib/i18n/server";

export default async function CompetitorScreen(params: Promise<{ series: string; id: string; personId: string }>, studio: boolean) {
  const user = studio ? await requireRole("studio") : await requireAccess("registrations.view");
  const { series: slug, id, personId } = await params;
  const series = studio ? await getStudioSeriesBySlug(user,slug) : (await requireSeries(params)).series;
  if (!series) notFound();
  const [team] = await getScopedRoster(series.id, user, id);
  const person = team?.competitors.find((person) => person.id === personId);
  if (!team || !person) notFound();
  const { t } = await getTranslator();

  // Changing who stands here is the same act as pairing two athletes, so it is
  // the same permission — and read-only stand-ins never get the panel.
  const maySwap = !user.viewAs && can(user, "registrations.pair");
  const seat = maySwap ? await readSwapSeat(personId, user) : null;
  const candidates = seat?.door.open ? await listSwapCandidates(user, series.id) : [];

  return <PageShell title={person.fullName}><article className="mobile-detail"><dl><dt>{t("Team")}</dt><dd>{team.name}</dd><dt>{t("Email")}</dt><dd>{person.email ?? "—"}</dd><dt>{t("Phone")}</dt><dd dir="ltr">{person.phone ?? "—"}</dd><dt>{t("Studio")}</dt><dd>{person.studioName ?? t("Non-member")}</dd><dt>{t("Category")}</dt><dd>{t(team.category)} · {t(team.division)}</dd></dl></article>
    {seat ? (
      <SwapMemberPanel
        competitorId={seat.competitorId}
        fullName={seat.fullName}
        door={seat.door}
        candidates={candidates}
      />
    ) : null}
  </PageShell>;
}
