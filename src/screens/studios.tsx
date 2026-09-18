import { notFound } from "next/navigation";
import { StudioDirectory, type DirectoryRow } from "@/components/series/studio-directory";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * THE STUDIO DIRECTORY.
 *
 * Every BFT studio in the region, whether or not it is in any competition.
 * Which of them takes part in a given PODIUM is chosen inside that competition
 * — this is only the list they are chosen from.
 */
export default async function StudiosPage(detailId?: string, editMode = false) {
  await requireRole("admin");
  const { t } = await getTranslator();

  const studios = await prisma.studio.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { teams: true, users: true, competitors: true, series: true } },
    },
  });

  const rows: DirectoryRow[] = studios.map((studio) => ({
    id: studio.id,
    name: studio.name,
    isActive: studio.isActive,
    teams: studio._count.teams,
    accounts: studio._count.users,
    members: studio._count.competitors,
    competitions: studio._count.series,
  }));

  if (detailId && !rows.some(item => item.id === detailId)) notFound();
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Studios")}</h1>
          <p>
            {t(
              "Every BFT studio in the region. Which of them takes part in a competition is chosen inside that competition."
            )}
          </p>
        </div>
      </div>

      <StudioDirectory studios={rows} detailId={detailId} editMode={editMode} />
    </div>
  );
}
