import type { SeriesScreenProps } from "@/screens/types";
import { notFound } from "next/navigation";
import Link from "next/link";

import { ScoreGrid } from "@/components/scores/score-grid";
import type { GridTeam } from "@/components/scores/score-grid-types";
import { WavesTimer } from "@/components/scores/waves-timer";
import { getTranslator } from "@/lib/i18n/server";
import { getScopedTeams, getSeriesZones } from "@/lib/queries";
import { getSeriesScoreAudit } from "@/lib/queries-people";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { can } from "@/lib/access";
import { requireAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * THE SCORE CONSOLE.
 *
 * Every team on one sheet, for BFT MENA: the judges score zone by zone from
 * their own sheets (my-wave), and each zone they submit shows here locked.
 * Starting and ending waves is the supervisor's, on Wave control — this
 * screen only shows the clocks.
 *
 * Scores are entered on ONE SHEET, the way the franchise manual does it: with a
 * hundred pairs, picking a team, opening a screen, saving and going back is the
 * slowest part of the day. The one-team card is still there — it opens under a
 * row when its outlier check, its factors or its unlock are wanted.
 */
export default async function ScoresPage(props: SeriesScreenProps, detailId?: string) {
  const user = await requireAccess("scores.view");
  const live = !user.viewAs;
  const gridRights = {
    editBudget: 0,
    budgetApplies: false,
    // Correcting after the clock, and unlocking, are BFT MENA Full access only.
    canEditAfterClose: can(user, "scores.correct"),
    isAdmin: can(user, "scores.unlock") && live,
    // Whole-team entry here is BFT MENA's; judges have their own sheet.
    frozen: !can(user, "scores.enter") || !live || !(user.role === "admin" || user.role === "staff"),
  };
  const searchParams = await props.searchParams;
  const { t } = await getTranslator();

  const { series, waves, waveSummary } = await requireSeries(props.params);

  const [teams, zones, audit] = await Promise.all([
    getScopedTeams(series.id, user),
    getSeriesZones(series.id),
    getSeriesScoreAudit(series.id, 8, detailId),
  ]);

  // One wave at a time is how the floor actually runs, so the sheet narrows to
  // it — while the placings beside each row still come from the whole field.
  const waveFilter = typeof searchParams.wave === "string" ? Number(searchParams.wave) : null;
  const shown = detailId
    ? teams.filter((team) => team.id === detailId)
    : waveFilter
      ? teams.filter((team) => team.wave === waveFilter)
      : teams;
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
    station: team.station,
    competitors: team.competitors.map((person) => person.fullName),
    submitted: team.submitted,
    lockedZones: team.lockedZones,
    scoreEdits: team.scoreEdits,
    waveEndsAt: waveEndsAt[team.wave] ?? null,
    waveEnded: waveEndsAt[team.wave] ? new Date(waveEndsAt[team.wave]) <= new Date() : false,
    paymentStatus: team.paymentStatus,
    waitlistedAt: team.waitlistedAt,
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

  if (detailId) {
    return (
      <div className="screen">
        <ScoreGrid teams={rows} zones={zones} {...gridRights} detailId={detailId} />
      </div>
    );
  }

  return (
    <div className="screen">
      <WavesTimer
        runningWaves={waveSummary.runningNumbers}
        remainingByWave={Object.fromEntries(waves.map((wave) => [wave.number, wave.remainingMs]))}
      />

      <div className="screen-head" style={{ marginTop: 26 }}>
        <div>
          <h1>{t("Score entry")}</h1>
          <p>
            {t(
              "Every team on one sheet. The judges submit each zone from their own sheet, and it shows here locked. Starting and ending waves is on Wave control."
            )}
          </p>
        </div>
        {can(user, "waveControl.view") ? (
          <Link href={seriesHref(series.slug, "wave-control")} className="btn btn-secondary">
            {t("Wave control")}
          </Link>
        ) : null}
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

      <ScoreGrid teams={rows} zones={zones} {...gridRights} />
    </div>
  );
}
