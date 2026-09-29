import "server-only";

import { zoneSchedule, type FloorTiming, type PlannedWave } from "@/lib/floor";
import { prisma } from "@/lib/prisma";
import { formatQatarDayKey, parseQatarWallTime } from "@/lib/qatar-time";
import { onTheFloor } from "@/lib/ownership";

// ─────────────────────────────────────────────────────────────────────────────
// A JUDGE'S DAY — every wave that will come through their zone, and the team
// each one brings to their station, from the first wave to the last.
//
// The judge sheet used to show a team only once its clock had started in the
// zone, so the judge met the pair at the same moment as the countdown. This
// shows them coming: the next wave, who is in it, and roughly when it
// arrives — so they can call the pair over and brief them in the changeover.
//
// READ-ONLY. It never carries a score and never decides what may be written:
// scoring still waits for the wave to reach the zone (zone-score-rules.ts).
// ─────────────────────────────────────────────────────────────────────────────

export type JudgeDayTeam = {
  id: string;
  number: number;
  /** Null while names are held back (see `namesHidden`). */
  name: string | null;
  station: number | null;
  athletes: string[];
  checkedIn: boolean;
  /** Paid and holding a place — only these appear on the rig screens and the board. */
  competing: boolean;
};

export type JudgeDayRow = {
  waveId: string;
  number: number;
  state: "done" | "here" | "coming";
  workStartsAt: string;
  workEndsAt: string;
  estimated: boolean;
  overdue: boolean;
  teams: JudgeDayTeam[];
};

export type JudgeDay = {
  zoneNumber: number;
  /** The judge's station; null for a leader, or someone not placed yet (they see every station). */
  station: number | null;
  allStations: boolean;
  /**
   * Before the competition is running, a gym's own account judging sees wave,
   * time and team number but not names: a gym owner does not get to read
   * rival gyms' entries ahead of the day. On the day everyone signed in sees
   * them on the board anyway.
   */
  namesHidden: boolean;
  rows: JudgeDayRow[];
};

export async function loadJudgeDay(input: {
  seriesId: string;
  zoneIndex: number;
  zoneNumber: number;
  station: number | null;
  leader: boolean;
  viewerRole: string;
  timing: FloorTiming;
  now: Date;
}): Promise<JudgeDay> {
  const { seriesId, zoneIndex, timing, now } = input;
  const allStations = input.leader || !input.station;

  const [series, waves, teams] = await Promise.all([
    prisma.series.findUnique({ where: { id: seriesId }, select: { status: true, competitionDate: true } }),
    prisma.wave.findMany({
      where: { seriesId },
      orderBy: { number: "asc" },
      select: { id: true, number: true, status: true, startedAt: true, endsAt: true, startTime: true },
    }),
    // The same field a wave starts with: not withdrawn, not on the waiting list.
    prisma.team.findMany({
      where: {
        seriesId,
        archivedAt: null,
        waitlistedAt: null,
        waveId: { not: null },
        ...(allStations ? {} : { station: input.station ?? -1 }),
      },
      orderBy: [{ station: "asc" }, { number: "asc" }],
      select: {
        id: true,
        number: true,
        name: true,
        station: true,
        waveId: true,
        attendedAt: true,
        paymentStatus: true,
        waitlistedAt: true,
        competitors: { select: { fullName: true }, orderBy: { position: "asc" } },
      },
    }),
  ]);

  // Whether a pending wave can start at all — it needs a team. Counted over
  // the whole wave, not just this station.
  const occupied = new Set(
    (
      await prisma.team.groupBy({
        by: ["waveId"],
        where: { seriesId, archivedAt: null, waitlistedAt: null, waveId: { not: null } },
        _count: { _all: true },
      })
    ).map((row) => row.waveId)
  );

  const day = series ? formatQatarDayKey(series.competitionDate) : null;
  const planned: PlannedWave[] = waves.map((wave) => ({
    id: wave.id,
    number: wave.number,
    status: wave.status,
    startedAt: wave.startedAt,
    endsAt: wave.endsAt,
    plannedStart: day ? parseQatarWallTime(`${day}T${wave.startTime}`) : null,
    hasTeams: occupied.has(wave.id),
  }));

  const namesHidden = input.viewerRole === "studio" && series?.status !== "live";
  const byWave = new Map<string, JudgeDayTeam[]>();
  for (const team of teams) {
    if (!team.waveId) continue;
    const row: JudgeDayTeam = {
      id: team.id,
      number: team.number,
      name: namesHidden ? null : team.name,
      station: team.station,
      athletes: namesHidden ? [] : team.competitors.map((person) => person.fullName),
      checkedIn: !!team.attendedAt,
      competing: onTheFloor(team),
    };
    const list = byWave.get(team.waveId) ?? [];
    list.push(row);
    byWave.set(team.waveId, list);
  }

  return {
    zoneNumber: input.zoneNumber,
    station: input.leader ? null : input.station,
    allStations,
    namesHidden,
    rows: zoneSchedule(planned, zoneIndex, timing, now).map((visit) => ({
      waveId: visit.waveId,
      number: visit.number,
      state: visit.state,
      workStartsAt: visit.workStartsAt.toISOString(),
      workEndsAt: visit.workEndsAt.toISOString(),
      estimated: visit.estimated,
      overdue: visit.overdue,
      teams: byWave.get(visit.waveId) ?? [],
    })),
  };
}
