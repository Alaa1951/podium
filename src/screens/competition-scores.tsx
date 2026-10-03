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
import { requireConsoleAccess } from "@/lib/session";

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
  const user = await requireConsoleAccess("scores.view");
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
  //
  // The filter is REAL membership — the wave row a team stands in (waveId) —
  // not the loose `Team.wave` number, which defaults to 1 before a team is
  // placed at all: a team admitted late but never seated used to inflate the
  // first wave's sheet with rows it never held. Those teams get their own
  // "Without wave" view (`?wave=none`) instead.
  const waveParam = typeof searchParams.wave === "string" ? searchParams.wave : null;
  const numberByWaveId = new Map(waves.map((wave) => [wave.id, wave.number]));
  const selectedWave = waveParam && waveParam !== "none" ? waves.find((wave) => String(wave.number) === waveParam) : null;
  const shown = detailId
    ? teams.filter((team) => team.id === detailId)
    : waveParam === "none"
      ? teams.filter((team) => !team.waveId)
      : selectedWave
        ? teams.filter((team) => team.waveId === selectedWave.id)
        : waveParam
          ? []
          : teams;
  const placedTeams = teams.filter((team) => team.waveId !== null);
  const unplacedCount = teams.length - placedTeams.length;
  const waveNumbers = [
    ...new Set(placedTeams.flatMap((team) => (team.waveId ? [numberByWaveId.get(team.waveId)] : []))),
  ]
    .filter((number): number is number => number !== undefined)
    .sort((a, b) => a - b);
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
    wave: team.waveId ? team.wave : null,
    station: team.station,
    competitors: team.competitors.map((person) => person.fullName),
    submitted: team.submitted,
    lockedZones: team.lockedZones,
    scoreEdits: team.scoreEdits,
    // An unplaced team holds no clock: wave 1's ended clock must not read as
    // theirs (it used to show them "Wave clock finished").
    waveEndsAt: team.waveId ? waveEndsAt[team.wave] ?? null : null,
    finisherWorkMinutes: series.zoneWorkMinutes,
    waveEnded: team.waveId && waveEndsAt[team.wave] ? new Date(waveEndsAt[team.wave]) <= new Date() : false,
    paymentStatus: team.paymentStatus,
    waitlistedAt: team.waitlistedAt,
    groupPortraitPath: team.groupPortraitPath,
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

      {waveNumbers.length > 1 || unplacedCount > 0 ? (
        <div className="chip-row" style={{ marginBottom: 14 }}>
          <Link href={here} className="chip" data-active={waveParam === null || undefined}>
            {t("All waves")}
          </Link>
          {waveNumbers.map((number) => (
            <Link
              key={number}
              href={`${here}?wave=${number}`}
              className="chip"
              data-active={selectedWave?.number === number || undefined}
            >
              {t("Wave")} {number}
            </Link>
          ))}
          {unplacedCount > 0 ? (
            <Link
              href={`${here}?wave=none`}
              className="chip"
              data-active={waveParam === "none" || undefined}
            >
              {t("Without wave")}
            </Link>
          ) : null}
        </div>
      ) : null}

      <ScoreGrid teams={rows} zones={zones} {...gridRights} />
    </div>
  );
}
