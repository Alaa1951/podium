// ─────────────────────────────────────────────────────────────────────────────
// THE FLOOR — waves moving through zones, stations fixed.
//
// How a competition day actually runs:
//
//   • A wave is at most nine teams. Each team stands on a STATION (1–9) and
//     keeps it in every zone: station 4 in Zone 1 is station 4 in Zone 4.
//   • The supervisor presses START once. From then on the wave moves by
//     itself: every zone is WORK minutes, then a BREAK to change zones, and
//     the last zone has no break after it. With four zones of 15 + 5 that is
//     20 + 20 + 20 + 15 = 75 minutes.
//   • The last zone is decided by the time left on the whole wave clock, so
//     the wave's own endsAt is the finisher clock.
//   • Several waves can be on the floor at once, one zone apart. A new wave
//     may start only once Zone 1 is free — which spaces waves one zone-slot
//     apart, so two waves can never meet in the same zone.
//
// Everything here is worked out from the moment the wave started. Nothing
// about the rotation is stored, so there is nothing to drift out of step.
// Pure and dependency-free: the supervisor page, the judge sheet, the board
// and the server actions all read the same arithmetic, and it is tested alone.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_STATIONS = 9;

export type FloorTiming = {
  /** Work time in each zone. */
  workMinutes: number;
  /** Changeover between zones. None after the last zone. */
  breakMinutes: number;
  /** How many zones the wave passes through, in order. */
  zoneCount: number;
};

/** The whole wave: every zone's work, and a break between each pair. */
export function waveLengthMinutes({ workMinutes, breakMinutes, zoneCount }: FloorTiming): number {
  if (zoneCount <= 0) return 0;
  return zoneCount * workMinutes + (zoneCount - 1) * breakMinutes;
}

/** One zone's slot in a wave, as offsets from the wave's start in ms. */
export type ZoneWindow = {
  /** 0-based position in the running order. */
  index: number;
  workStartMs: number;
  workEndMs: number;
  /** End of the changeover after this zone; equals workEndMs for the last. */
  breakEndMs: number;
};

export function zoneWindows(timing: FloorTiming): ZoneWindow[] {
  const work = timing.workMinutes * 60_000;
  const slot = (timing.workMinutes + timing.breakMinutes) * 60_000;
  return Array.from({ length: Math.max(0, timing.zoneCount) }, (_, index) => {
    const workStartMs = index * slot;
    const workEndMs = workStartMs + work;
    const last = index === timing.zoneCount - 1;
    return { index, workStartMs, workEndMs, breakEndMs: last ? workEndMs : workStartMs + slot };
  });
}

export type FloorPhase = "pending" | "work" | "break" | "done";

export type WavePosition = {
  phase: FloorPhase;
  /** The zone the wave is working in, or has just left during a break. */
  zoneIndex: number | null;
  /** Time left in the current work or break window. */
  phaseRemainingMs: number | null;
  /** Time left on the whole wave clock — the finisher's clock. */
  waveRemainingMs: number | null;
};

/**
 * Where a wave is at `now`.
 *
 * `startedAt` null means it has not started. `completed` marks a wave the
 * supervisor ended early (or the clock ended) — it is done whatever the time.
 */
export function wavePosition(
  wave: { startedAt: Date | null; completed?: boolean },
  timing: FloorTiming,
  now: Date
): WavePosition {
  if (!wave.startedAt) return { phase: "pending", zoneIndex: null, phaseRemainingMs: null, waveRemainingMs: null };
  const total = waveLengthMinutes(timing) * 60_000;
  const elapsed = now.getTime() - wave.startedAt.getTime();
  // A start in the future (a clock a moment ahead of this one) is not a start yet.
  if (elapsed < 0) return { phase: "pending", zoneIndex: null, phaseRemainingMs: null, waveRemainingMs: null };
  if (wave.completed || elapsed >= total || timing.zoneCount === 0) {
    return { phase: "done", zoneIndex: null, phaseRemainingMs: null, waveRemainingMs: 0 };
  }
  const t = Math.max(0, elapsed);
  for (const window of zoneWindows(timing)) {
    if (t < window.workEndMs) {
      return { phase: "work", zoneIndex: window.index, phaseRemainingMs: window.workEndMs - t, waveRemainingMs: total - t };
    }
    if (t < window.breakEndMs) {
      return { phase: "break", zoneIndex: window.index, phaseRemainingMs: window.breakEndMs - t, waveRemainingMs: total - t };
    }
  }
  return { phase: "done", zoneIndex: null, phaseRemainingMs: null, waveRemainingMs: 0 };
}

/**
 * When Zone 1 is free again for a new wave to start, given the waves already
 * on the floor. A wave holds Zone 1 for its work plus the changeover after
 * it. Null means free now.
 */
export function zoneOneFreeAt(
  running: { startedAt: Date | null }[],
  timing: FloorTiming,
  now: Date
): Date | null {
  const slotMs = (timing.workMinutes + (timing.zoneCount > 1 ? timing.breakMinutes : 0)) * 60_000;
  const busyUntil = running
    .filter((wave) => wave.startedAt)
    .map((wave) => wave.startedAt!.getTime() + slotMs)
    .filter((until) => until > now.getTime());
  return busyUntil.length ? new Date(Math.max(...busyUntil)) : null;
}

// ── Zone duty: which wave a zone's judges are scoring ────────────────────────
//
// A judge scores ONE team: the one on their station, in the wave their zone
// is on. The screen and the server both ask the functions below, so what a
// judge is shown and what they may write can never disagree.

/** A wave as the floor rules need it. */
export type FloorWave = {
  id: string;
  status: "pending" | "running" | "complete";
  startedAt: Date | null;
  /** When the clock runs (or ran) out — for a wave ended with End now, the moment it was ended. */
  endsAt: Date | null;
};

/** The leader's last instant for this team's zone, including its changeover.
 * The last zone has no changeover. An early End now shortens the window.
 * Arrival and a running status are checked separately by the write rules. */
export function zoneScoreEntryClosesAt(wave: FloorWave, zoneIndex: number, timing: FloorTiming): Date | null {
  const window = zoneWindows(timing)[zoneIndex];
  if (!wave.startedAt || !window || wave.status === "pending") return null;
  const closesAt = wave.startedAt.getTime() + window.breakEndMs;
  return new Date(Math.min(closesAt, wave.endsAt?.getTime() ?? Infinity));
}

/**
 * When a wave's work in a zone began, as epoch ms — or null when it has not
 * got there: not started (or reset), not arrived yet, or ENDED before that
 * zone's work began. A complete wave reached only the zones it started
 * before its end: treating every complete wave as having been everywhere put
 * a wave ended in Zone 1 on the sheets of Zones 2 to 4.
 */
export function zoneArrival(wave: FloorWave, zoneIndex: number, timing: FloorTiming, now: Date): number | null {
  if (wave.status === "pending" || !wave.startedAt) return null;
  const window = zoneWindows(timing)[zoneIndex];
  if (!window) return null;
  const arrival = wave.startedAt.getTime() + window.workStartMs;
  if (arrival > now.getTime()) return null;
  if (wave.status === "complete" && wave.endsAt && arrival >= wave.endsAt.getTime()) return null;
  return arrival;
}

/**
 * The wave a zone is ON: of the waves that have reached it, the one that
 * arrived last. Its teams are the ones the zone's judges score — while it
 * works there, through the changeover after it, and (for a zone still not
 * submitted) until the next wave arrives and takes its place. Waves start at
 * least one zone-slot apart (zoneOneFreeAt), so a zone is never on two.
 */
export function waveOnDuty<W extends FloorWave>(
  waves: W[],
  zoneIndex: number,
  timing: FloorTiming,
  now: Date
): W | null {
  let onDuty: W | null = null;
  let latest = -Infinity;
  for (const wave of waves) {
    const arrival = zoneArrival(wave, zoneIndex, timing, now);
    if (arrival !== null && arrival > latest) {
      onDuty = wave;
      latest = arrival;
    }
  }
  return onDuty;
}

export type ZoneDuty<W extends FloorWave> = {
  /** The wave the zone is on, or null before any wave has reached it. */
  wave: W | null;
  /**
   * Where that wave is, seen from this zone: working here, in the changeover
   * right after, or gone on (moved to the next zone, or over).
   */
  phase: "work" | "break" | "left" | null;
  /** Time left in `work` or `break`; null otherwise. */
  phaseRemainingMs: number | null;
  /** The soonest running wave still to reach this zone, and how long until it does. */
  next: { wave: W; inMs: number } | null;
};

/** Everything a judge sheet shows about its zone at `now` — see waveOnDuty. */
export function zoneDuty<W extends FloorWave>(
  waves: W[],
  zoneIndex: number,
  timing: FloorTiming,
  now: Date
): ZoneDuty<W> {
  const window = zoneWindows(timing)[zoneIndex];
  const wave = waveOnDuty(waves, zoneIndex, timing, now);

  let phase: ZoneDuty<W>["phase"] = null;
  let phaseRemainingMs: number | null = null;
  if (wave && window && wave.startedAt) {
    const elapsed = now.getTime() - wave.startedAt.getTime();
    if (wave.status === "running" && elapsed < window.workEndMs) {
      phase = "work";
      phaseRemainingMs = window.workEndMs - elapsed;
    } else if (wave.status === "running" && elapsed < window.breakEndMs) {
      phase = "break";
      phaseRemainingMs = window.breakEndMs - elapsed;
    } else {
      phase = "left";
    }
  }

  let next: ZoneDuty<W>["next"] = null;
  if (window) {
    for (const candidate of waves) {
      if (candidate.status !== "running" || !candidate.startedAt) continue;
      if (zoneArrival(candidate, zoneIndex, timing, now) !== null) continue;
      const inMs = candidate.startedAt.getTime() + window.workStartMs - now.getTime();
      if (inMs > 0 && (!next || inMs < next.inMs)) next = { wave: candidate, inMs };
    }
  }

  return { wave, phase, phaseRemainingMs, next };
}

// ── The day ahead: when each wave reaches each zone ─────────────────────────
//
// A judge must see the team walking towards their station BEFORE its clock
// starts — not the second it does. Nothing about a wave that has not started
// is known for certain, so its times are an ESTIMATE, always shown as one:
// its scheduled start, pushed later when the floor runs behind (a wave can
// only start once Zone 1 is free, one zone-slot after the wave before it).
// A started wave's times are exact. Nothing here gates a write — scoring
// still waits for the wave to actually reach the zone (zoneArrival).

/** A wave with what the estimate needs: its place in the order and its planned start. */
export type PlannedWave = FloorWave & {
  number: number;
  /** The scheduled start as an instant (Qatar wall time on the day), or null if unknown. */
  plannedStart: Date | null;
  /** Whether any team is on it — an empty pending wave can never start. */
  hasTeams: boolean;
};

export type ProjectedStart = {
  startsAt: Date;
  /** True until the wave has actually started. */
  estimated: boolean;
  /** A pending wave whose scheduled start has already passed. */
  overdue: boolean;
};

/**
 * When every wave starts (or started). Started waves keep their real start.
 * Pending waves with teams follow in wave-number order: each at its planned
 * start, or as soon as Zone 1 is free after the one before it — whichever is
 * later, and never in the past. A pending wave with no team is left out: it
 * cannot start, and counting it would push every later wave back.
 */
export function projectWaveStarts(
  waves: PlannedWave[],
  timing: FloorTiming,
  now: Date
): Map<string, ProjectedStart> {
  const result = new Map<string, ProjectedStart>();
  const slotMs = (timing.workMinutes + (timing.zoneCount > 1 ? timing.breakMinutes : 0)) * 60_000;
  const running: { startedAt: Date | null }[] = [];
  for (const wave of waves) {
    if (wave.status === "pending" || !wave.startedAt) continue;
    result.set(wave.id, { startsAt: wave.startedAt, estimated: false, overdue: false });
    if (wave.status === "running") running.push(wave);
  }
  let cursor = Math.max(now.getTime(), zoneOneFreeAt(running, timing, now)?.getTime() ?? 0);
  const pending = waves
    .filter((wave) => (wave.status === "pending" || !wave.startedAt) && wave.hasTeams)
    .sort((a, b) => a.number - b.number);
  for (const wave of pending) {
    const planned = wave.plannedStart?.getTime() ?? null;
    const start = Math.max(cursor, planned ?? cursor);
    result.set(wave.id, { startsAt: new Date(start), estimated: true, overdue: planned !== null && planned < now.getTime() });
    cursor = start + slotMs;
  }
  return result;
}

/** One wave's visit to one zone. */
export type ZoneVisit = {
  waveId: string;
  number: number;
  /** done: gone through (or ended); here: working or changing over in it; coming: still to arrive. */
  state: "done" | "here" | "coming";
  workStartsAt: Date;
  workEndsAt: Date;
  /** True while the wave has not started — the times are an estimate. */
  estimated: boolean;
  overdue: boolean;
};

/**
 * Every wave's visit to one zone across the day, in the order they reach it.
 * A wave ended before it got to the zone never visits it.
 */
export function zoneSchedule(waves: PlannedWave[], zoneIndex: number, timing: FloorTiming, now: Date): ZoneVisit[] {
  const window = zoneWindows(timing)[zoneIndex];
  if (!window) return [];
  const starts = projectWaveStarts(waves, timing, now);
  const visits: ZoneVisit[] = [];
  for (const wave of waves) {
    const start = starts.get(wave.id);
    if (!start) continue;
    const base = start.startsAt.getTime();
    const workStart = base + window.workStartMs;
    let state: ZoneVisit["state"];
    if (wave.status === "complete") {
      // Ended before this zone's work began: it never came here.
      if (wave.endsAt && workStart >= wave.endsAt.getTime()) continue;
      state = "done";
    } else if (start.estimated || now.getTime() < workStart) {
      state = "coming";
    } else if (now.getTime() < base + window.breakEndMs) {
      state = "here";
    } else {
      state = "done";
    }
    visits.push({
      waveId: wave.id,
      number: wave.number,
      state,
      workStartsAt: new Date(workStart),
      workEndsAt: new Date(base + window.workEndMs),
      estimated: start.estimated,
      overdue: start.overdue,
    });
  }
  return visits.sort((a, b) => a.workStartsAt.getTime() - b.workStartsAt.getTime() || a.number - b.number);
}

/** One wave's time in each zone, in running order — what an athlete is told about their day. */
export type ZoneSlot = {
  zoneIndex: number;
  workStartsAt: Date;
  workEndsAt: Date;
  state: "done" | "here" | "coming";
  estimated: boolean;
};

export function waveZoneTimes(waves: PlannedWave[], waveId: string, timing: FloorTiming, now: Date): ZoneSlot[] {
  const wave = waves.find((one) => one.id === waveId);
  const start = projectWaveStarts(waves, timing, now).get(waveId);
  if (!wave || !start) return [];
  const base = start.startsAt.getTime();
  const slots: ZoneSlot[] = [];
  for (const window of zoneWindows(timing)) {
    const workStart = base + window.workStartMs;
    // An ended wave never reached the zones after it ended.
    if (wave.status === "complete" && wave.endsAt && workStart >= wave.endsAt.getTime()) break;
    const state: ZoneSlot["state"] =
      wave.status === "complete"
        ? "done"
        : start.estimated || now.getTime() < workStart
          ? "coming"
          : now.getTime() < base + window.breakEndMs
            ? "here"
            : "done";
    slots.push({
      zoneIndex: window.index,
      workStartsAt: new Date(workStart),
      workEndsAt: new Date(base + window.workEndMs),
      state,
      estimated: start.estimated,
    });
  }
  return slots;
}

/** The lowest free station in a wave, or null when all nine are taken. */
export function lowestFreeStation(taken: (number | null)[], capacity = MAX_STATIONS): number | null {
  const used = new Set(taken.filter((station): station is number => station !== null));
  for (let station = 1; station <= Math.min(capacity, MAX_STATIONS); station++) {
    if (!used.has(station)) return station;
  }
  return null;
}

/**
 * How many station slots a screen should draw for a wave.
 *
 * The wave's own capacity, normally: a wave set to seven teams should not draw
 * nine rigs with two of them permanently empty. `MAX_STATIONS` is the floor's
 * hard limit — nine rigs exist — not the number to show.
 *
 * But NEVER fewer than the highest station actually occupied. Lowering the
 * capacity under a wave whose teams are already placed has to show the ones
 * standing off the end, not hide them: a team nobody can see is a team nobody
 * moves, and it is found on the morning of the competition.
 */
export function stationSlots(capacity: number, occupied: (number | null)[]): number {
  const highest = occupied.reduce<number>((max, station) => Math.max(max, station ?? 0), 0);
  return Math.min(MAX_STATIONS, Math.max(1, capacity, highest));
}

/**
 * The finisher record, from the time left on the whole wave clock.
 *
 * The last zone is the last `workMinutes` of the wave, so what a team can
 * have left there is never more than one zone's work: with 15-minute zones a
 * 75-minute wave stopped at 72:00 leaves 3:00. More than that on the wave
 * clock means the wave has not reached the last zone yet, so there is no
 * finisher to record — null. Callers ending a wave treat that as 0:00: a team
 * that never ran the finisher did not finish it.
 */
export function finisherRemainingMs(waveRemainingMs: number, workMinutes: number): number | null {
  const remaining = Math.max(0, waveRemainingMs);
  return remaining > workMinutes * 60_000 ? null : remaining;
}

/** Minutes and seconds of a remaining time — the finisher record. */
export function remainingClock(ms: number): { minutes: number; seconds: number } {
  const clamped = Math.max(0, ms);
  return { minutes: Math.floor(clamped / 60_000), seconds: Math.floor((clamped % 60_000) / 1000) };
}
