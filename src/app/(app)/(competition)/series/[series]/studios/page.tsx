import Link from "next/link";

import { StudioPicker, type StudioRow } from "@/components/series/studio-picker";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { requireSeries } from "@/lib/require-series";
import { can } from "@/lib/access";
import { requireConsoleAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * THE STUDIOS TAKING PART.
 *
 * Creating a competition and then choosing who is in it is the real order of
 * events, and the step the system used to skip — studios existed globally and
 * a competition had no idea which of them it concerned.
 */
export default async function SeriesStudiosPage(props: PageProps<"/series/[series]/studios">) {
  const user = await requireConsoleAccess("competitionStudios.view");
  const canPick = can(user, "competitionStudios.edit") && !user.viewAs;
  // The directory itself (/studios) is studios.view — BFT MENA only.
  const canOpenDirectory = can(user, "studios.view");
  const { t } = await getTranslator();

  const { series } = await requireSeries(props.params);

  const [studios, taking, teamCounts, accountCounts] = await Promise.all([
    prisma.studio.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.seriesStudio.findMany({ where: { seriesId: series.id }, select: { studioId: true } }),
    prisma.team.groupBy({
      by: ["studioId"],
      where: { seriesId: series.id, studioId: { not: null } },
      _count: true,
    }),
    prisma.user.groupBy({
      by: ["studioId"],
      where: { role: "studio", studioId: { not: null } },
      _count: true,
    }),
  ]);

  const takingIds = new Set(taking.map((row) => row.studioId));
  const teams = new Map(teamCounts.map((row) => [row.studioId, row._count]));
  const accounts = new Map(accountCounts.map((row) => [row.studioId, row._count]));

  const rows: StudioRow[] = studios.map((studio) => ({
    id: studio.id,
    name: studio.name,
    taking: takingIds.has(studio.id),
    teams: teams.get(studio.id) ?? 0,
    accounts: accounts.get(studio.id) ?? 0,
  }));

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Studios")}</h1>
          <p>
            {t(
              "Which studios are in this competition. A studio here can register its teams and follow its own entries; one that is not is simply not taking part."
            )}
          </p>
        </div>
        {canOpenDirectory ? (
          <div className="screen-head-actions">
            <Link href="/studios" className="btn btn-secondary">
              {t("Manage the directory")}
            </Link>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="notice">
          <strong>{t("No studios in the directory.")}</strong>{" "}
          {canOpenDirectory ? (
            <Link href="/studios" className="linkish">
              {t("Add one first.")}
            </Link>
          ) : null}
        </div>
      ) : (
        <StudioPicker seriesId={series.id} studios={rows} readOnly={!canPick} />
      )}

      <div className="notice" style={{ marginTop: 20 }}>
        <strong>{t("What a studio may do here.")}</strong>{" "}
        {t(
          "Studios register and pair their own athletes, place their teams in waves, and follow their own results. Scores are entered by the judges on the floor."
        )}{" "}
        <Link href={`/series/${series.slug}/settings`} className="linkish">
          {t("Settings")}
        </Link>
      </div>
    </div>
  );
}
