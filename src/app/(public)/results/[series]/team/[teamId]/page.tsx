import { notFound } from "next/navigation";

import { PublicShell } from "@/components/public/public-shell";
import { PublicTeamResult } from "@/components/public/results-team";
import { getTranslator } from "@/lib/i18n/server";
import { publishedCompetition, publishedTeam } from "@/lib/public-results";

export const dynamic = "force-dynamic";

/** One team's published result — the page somebody sends to a friend. */
export default async function PublicTeamPage(props: PageProps<"/results/[series]/team/[teamId]">) {
  const { series, teamId } = await props.params;
  const { t } = await getTranslator();

  const competition = await publishedCompetition(series);
  if (!competition) notFound();

  const result = await publishedTeam(competition.id, teamId);
  if (!result) notFound();

  const { team, rank, fieldSize, zones } = result;

  return (
    <PublicShell
      back={{
        href: `/results/${competition.slug}/${team.category}/${team.division}`,
        label: t("Back"),
      }}
    >
      <PublicTeamResult
        rank={rank}
        fieldSize={fieldSize}
        name={team.name}
        competitors={competition.showCompetitorNames ? team.competitors.map((p) => p.fullName) : []}
        studioName={competition.showStudioColumn ? team.studioName : null}
        category={team.category}
        division={team.division}
        total={team.total}
        zones={zones}
      />
    </PublicShell>
  );
}
