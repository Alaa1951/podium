import type { SeriesScreenProps } from "@/screens/types";
import { notFound } from "next/navigation";
import Link from "next/link";

import { ScoreGrid } from "@/components/scores/score-grid";
import type { GridTeam } from "@/components/scores/score-grid-types";
import { WaveAccessCard } from "@/components/scores/wave-access-card";
import { WavesTimer } from "@/components/scores/waves-timer";
import { WaveControl } from "@/components/scores/wave-control";
import { getTranslator } from "@/lib/i18n/server";
import { getScopedTeams, getSeriesZones } from "@/lib/queries";
import { getSeriesScoreAudit } from "@/lib/queries-people";
import { prisma } from "@/lib/prisma";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { can } from "@/lib/access";
import { requirePermission, scoreWriteBudget } from "@/lib/session";
import { listAccounts } from "@/lib/queries-people";

export const dynamic = "force-dynamic";

/**
 * THE FLOOR.
 *
 * Starting waves and recording what happened in them — the two things an
 * operator does all day, on one screen, because they are done standing in the
 * same place at the same moment.
 *
 * Scores are entered on ONE SHEET, the way the franchise manual does it: with a
 * hundred pairs, picking a team, opening a screen, saving and going back is the
 * slowest part of the day. The one-team card is still there — it opens under a
 * row when its outlier check, its factors or its unlock are wanted.
 */
export default async function ScoresPage(props: SeriesScreenProps, detailId?: string) {
  const user = await requirePermission("scores.view");
  const searchParams = await props.searchParams;
  const { t } = await getTranslator();

  const { series, waves, waveSummary } = await requireSeries(props.params);

  const [teams, zones, audit, accounts, grants] = await Promise.all([
    getScopedTeams(series.id, user),
    getSeriesZones(series.id),
    getSeriesScoreAudit(series.id),
    listAccounts(user),
    prisma.waveAccess.findMany({
      where: { wave: { seriesId: series.id } },
      orderBy: [{ wave: { number: "asc" } }, { user: { email: "asc" } }],
      select: {
        id: true,
        wave: { select: { number: true } },
        user: { select: { email: true, name: true } },
      },
    }),
  ]);

  // One wave at a time is how the floor actually runs, so the sheet narrows to
  // it — while the placings beside each row still come from the whole field.
  const waveFilter = typeof searchParams.wave === "string" ? Number(searchParams.wave) : null;
  const shown = !detailId && waveFilter ? teams.filter((team) => team.wave === waveFilter) : teams;
  const waveNumbers = [...new Set(teams.map((team) => team.wave))].sort((a, b) => a - b);
  const here = seriesHref(series.slug, "scores");

  // When each wave clock runs out — the finisher stop reads it per team.
  const waveEndsAt: Record<number, string> = {};
  for (const wave of waves) {
    if (wave.endsAt) waveEndsAt[wave.number] = wave.endsAt;
  }

  const rows: GridTeam[] = shown.map((team) => ({
    id: team.id,
    number: team.number,
    name: team.name,
    category: team.category,
    division: team.division,
    wave: team.wave,
    competitors: team.competitors.map((person) => person.fullName),
    submitted: team.submitted,
    scoreEdits: team.scoreEdits,
    waveEndsAt: waveEndsAt[team.wave] ?? null,
    waveEnded: waveEndsAt[team.wave] ? new Date(waveEndsAt[team.wave]) <= new Date() : false,
    paymentStatus: team.paymentStatus,
    values: team.values,
    peerTotals: teams
      .filter(
        (other) =>
          other.id !== team.id &&
          other.submitted &&
          other.category === team.category &&
          other.division === team.division
      )
      .map((other) => other.total),
    audit: audit.get(team.id) ?? [],
  }));

  if (detailId && !teams.some((team) => team.id === detailId)) notFound();

  if (detailId) return <div className="screen"><ScoreGrid teams={rows} zones={zones} editBudget={scoreWriteBudget(series)} budgetApplies={user.role === "studio"} isAdmin={user.role === "admin"} frozen={!can(user, "scores.edit") || !!user.viewAs} canEditAfterClose={user.role === "admin" || can(user, "scores.afterClose")} detailId={detailId} /></div>;

  return (
    <div className="screen">
      <WaveControl waves={waves} summary={waveSummary} canControl={user.role === "admin" && !user.viewAs} />

      <WavesTimer
        runningWaves={waveSummary.runningNumbers}
        remainingByWave={Object.fromEntries(
          waves.map((wave) => [wave.number, wave.remainingMs])
        )}
      />

      <div className="screen-head" style={{ marginTop: 26 }}>
        <div>
          <h1>{t("Score entry")}</h1>
          <p>
            {t(
              "Every team on one sheet. Type across a row and save it; open a team's name for the full card and its outlier check."
            )}
          </p>
        </div>
      </div>

      {waveNumbers.length > 1 ? (
        <div className="chip-row" style={{ marginBottom: 14 }}>
          <Link href={here} className="chip" data-active={waveFilter === null || undefined}>
            {t("All waves")}
          </Link>
          {waveNumbers.map((number) => (
            <Link
              key={number}
              href={`${here}?wave=${number}`}
              className="chip"
              data-active={waveFilter === number || undefined}
            >
              {t("Wave")} {number}
            </Link>
          ))}
        </div>
      ) : null}

      <ScoreGrid
        teams={rows}
        zones={zones}
        editBudget={scoreWriteBudget(series)}
        budgetApplies={user.role === "studio"}
        canEditAfterClose={user.role === "admin" || can(user, "scores.afterClose")}
        isAdmin={user.role === "admin"}
        frozen={!can(user, "scores.edit") || !!user.viewAs}
      />

      {user.role === "admin" && !user.viewAs ? <WaveAccessCard
        waves={waves.map((wave) => ({ id: wave.id, number: wave.number }))}
        accounts={accounts.map((account) => ({
          id: account.id,
          email: account.email,
          name: account.name,
        }))}
        grants={grants.map((grant) => ({
          id: grant.id,
          waveNumber: grant.wave.number,
          email: grant.user.email,
          name: grant.user.name,
        }))}
      /> : null}
    </div>
  );
}
