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

/** Whether a wave has reached a zone yet (its work there has begun). */
export function hasReachedZone(
  wave: { startedAt: Date | null },
  zoneIndex: number,
  timing: FloorTiming,
  now: Date
): boolean {
  if (!wave.startedAt) return false;
  const window = zoneWindows(timing)[zoneIndex];
  if (!window) return false;
  return now.getTime() - wave.startedAt.getTime() >= window.workStartMs;
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

/**
 * Which wave is in a given zone at `now` — working there, or in the break
 * right after it (the judges are still finishing that team's sheet).
 */
export function waveInZone<W extends { startedAt: Date | null; completed?: boolean }>(
  waves: W[],
  zoneIndex: number,
  timing: FloorTiming,
  now: Date
): { wave: W; phase: "work" | "break"; phaseRemainingMs: number } | null {
  for (const wave of waves) {
    const position = wavePosition(wave, timing, now);
    if ((position.phase === "work" || position.phase === "break") && position.zoneIndex === zoneIndex) {
      return { wave, phase: position.phase, phaseRemainingMs: position.phaseRemainingMs ?? 0 };
    }
  }
  return null;
}

/** The lowest free station in a wave, or null when all nine are taken. */
export function lowestFreeStation(taken: (number | null)[], capacity = MAX_STATIONS): number | null {
  const used = new Set(taken.filter((station): station is number => station !== null));
  for (let station = 1; station <= Math.min(capacity, MAX_STATIONS); station++) {
    if (!used.has(station)) return station;
  }
  return null;
}

/** Minutes and seconds of a remaining time — the finisher record. */
export function remainingClock(ms: number): { minutes: number; seconds: number } {
  const clamped = Math.max(0, ms);
  return { minutes: Math.floor(clamped / 60_000), seconds: Math.floor((clamped % 60_000) / 1000) };
}
