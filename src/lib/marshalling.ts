import {
  projectWaveStarts,
  wavePosition,
  zoneSchedule,
  zoneWindows,
  waveLengthMinutes,
  type FloorTiming,
  type PlannedWave,
} from "@/lib/floor";

// ─────────────────────────────────────────────────────────────────────────────
// MARSHALLING — the floor, for the people who move athletes.
//
// Three questions, answered from the same arithmetic as the judge sheet and
// Wave control (floor.ts), so nobody on the floor is told a different story:
//
//   • Zones now     what is in each zone, and what comes into it next;
//   • Moving next   where each wave on the floor goes next, and when;
//   • Call-up       the next waves to start: who to gather at Zone 1.
//
// Pure: the screen loads the rows and asks this. Times of a wave that has not
// started are an estimate (projectWaveStarts) and say so.
// ─────────────────────────────────────────────────────────────────────────────

export type ZoneNow = {
  zoneIndex: number;
  /** The wave working in the zone, or changing over out of it. */
  current: { waveId: string; phase: "work" | "break"; endsAt: Date } | null;
  /** The next wave to reach the zone. */
  next: { waveId: string; arrivesAt: Date; estimated: boolean } | null;
};

export type WaveMove = {
  waveId: string;
  /** The zone it goes to next, or null when the next thing is the finish. */
  toZoneIndex: number | null;
  at: Date;
};

export type CallUp = { waveId: string; startsAt: Date; estimated: boolean; overdue: boolean };

export type MarshallingPlan = { zones: ZoneNow[]; moves: WaveMove[]; callUp: CallUp[] };

export function marshallingPlan(
  waves: PlannedWave[],
  timing: FloorTiming,
  now: Date,
  callUpCount = 2
): MarshallingPlan {
  const windows = zoneWindows(timing);
  const zones: ZoneNow[] = windows.map((window) => {
    let current: ZoneNow["current"] = null;
    for (const wave of waves) {
      if (wave.status !== "running" || !wave.startedAt) continue;
      const position = wavePosition({ startedAt: wave.startedAt }, timing, now);
      if ((position.phase === "work" || position.phase === "break") && position.zoneIndex === window.index) {
        current = {
          waveId: wave.id,
          phase: position.phase,
          endsAt: new Date(now.getTime() + (position.phaseRemainingMs ?? 0)),
        };
      }
    }
    const coming = zoneSchedule(waves, window.index, timing, now).find((visit) => visit.state === "coming");
    return {
      zoneIndex: window.index,
      current,
      next: coming ? { waveId: coming.waveId, arrivesAt: coming.workStartsAt, estimated: coming.estimated } : null,
    };
  });

  const moves: WaveMove[] = [];
  for (const wave of waves) {
    if (wave.status !== "running" || !wave.startedAt) continue;
    const position = wavePosition({ startedAt: wave.startedAt }, timing, now);
    if (position.zoneIndex === null) continue;
    const following = windows[position.zoneIndex + 1];
    const start = wave.startedAt.getTime();
    moves.push(
      following
        ? { waveId: wave.id, toZoneIndex: following.index, at: new Date(start + following.workStartMs) }
        : { waveId: wave.id, toZoneIndex: null, at: new Date(start + waveLengthMinutes(timing) * 60_000) }
    );
  }
  moves.sort((a, b) => a.at.getTime() - b.at.getTime());

  const starts = projectWaveStarts(waves, timing, now);
  const callUp: CallUp[] = waves
    .filter((wave) => wave.status === "pending" && starts.has(wave.id))
    .map((wave) => ({ waveId: wave.id, ...starts.get(wave.id)! }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, callUpCount)
    .map(({ waveId, startsAt, estimated, overdue }) => ({ waveId, startsAt, estimated, overdue }));

  return { zones, moves, callUp };
}
