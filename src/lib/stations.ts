import type { BoardTeam } from "@/lib/board";
import type { WaveState } from "@/lib/waves";

// ─────────────────────────────────────────────────────────────────────────────
// WHO IS STANDING ON A RIG, RIGHT NOW.
//
// The screens hanging over the floor. Each one is bolted above one rig and has
// to say which pair is on it — and change by itself when that pair walks on.
//
// THE ADDRESS OF A SCREEN IS (ZONE × STATION), NOT A STATION ALONE, and that is
// the one thing to understand here. A team keeps the same station number in
// every zone of its wave (schema.prisma, `Team.station`), and several waves are
// on the floor at once, one zone apart. So at any instant there is a team on
// station 3 of zone 1 AND a different team on station 3 of zone 2. A screen
// showing "station 3" would be showing two teams' worth of ambiguity.
//
// Which wave is in which zone is already decided on the server — every wave in
// the board payload carries `floor.zoneNumber` and `floor.phase` (floor.ts).
// This file does the second half: find that wave's team with this station.
//
// Pure and dependency-free, so the thing the room reads off a wall is tested
// rather than trusted.
// ─────────────────────────────────────────────────────────────────────────────

/** What a station screen shows, in the three states it can be in. */
export type StationView =
  /** No wave is in this zone: between waves, or the event has not started. */
  | { state: "idle" }
  /** A wave is here but has fewer teams than stations — this rig is unused. */
  | { state: "empty"; wave: number; phase: FloorPhaseHere; phaseRemainingMs: number | null }
  /** Somebody is standing here. */
  | {
      state: "team";
      wave: number;
      phase: FloorPhaseHere;
      phaseRemainingMs: number | null;
      team: BoardTeam;
    };

/**
 * `work` is the pair actually working; `break` is the changeover, when they are
 * still on this rig and the judge is finishing their sheet. The screen must
 * keep showing them through the break — going blank the moment the buzzer
 * sounds is how a sheet gets filed against the wrong pair.
 */
export type FloorPhaseHere = "work" | "break";

/** The wave in a zone at this instant, from what the server already worked out. */
function waveHere(waves: WaveState[], zoneNumber: number): WaveState | null {
  for (const wave of waves) {
    if (wave.floor.zoneNumber !== zoneNumber) continue;
    if (wave.floor.phase === "work" || wave.floor.phase === "break") return wave;
  }
  return null;
}

/**
 * Who is on this rig now.
 *
 * `zoneNumber` is 1-BASED, matching `WaveState.floor.zoneNumber` and the zone
 * numbers printed on the floor. (`floor.ts` works in 0-based indexes
 * internally; nothing outside it needs to know that.)
 */
export function stationView(params: {
  waves: WaveState[];
  teams: BoardTeam[];
  zoneNumber: number;
  station: number;
}): StationView {
  const wave = waveHere(params.waves, params.zoneNumber);
  if (!wave) return { state: "idle" };

  const phase = wave.floor.phase as FloorPhaseHere;
  const team = params.teams.find(
    (one) => one.wave === wave.number && one.station === params.station
  );

  if (!team) {
    return { state: "empty", wave: wave.number, phase, phaseRemainingMs: wave.floor.phaseRemainingMs };
  }
  return {
    state: "team",
    wave: wave.number,
    phase,
    phaseRemainingMs: wave.floor.phaseRemainingMs,
    team,
  };
}

/**
 * Every station in one zone, in order — for a venue with one screen per zone
 * rather than one per rig.
 *
 * `capacity` comes from the wave that is actually in the zone, not from
 * MAX_STATIONS: a wave set to six teams should not draw nine rigs, three of
 * them permanently empty.
 */
export function zoneStations(params: {
  waves: WaveState[];
  teams: BoardTeam[];
  zoneNumber: number;
}): { station: number; view: StationView }[] {
  const wave = waveHere(params.waves, params.zoneNumber);
  if (!wave) return [];
  return Array.from({ length: wave.capacity }, (_, index) => {
    const station = index + 1;
    return {
      station,
      view: stationView({ ...params, station }),
    };
  });
}
