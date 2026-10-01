import type { Category } from "@/generated/prisma/enums";
import {
  clockLabel,
  clockMinutes,
  DAY_MINUTES,
  MAX_WAVES,
  type BlockConfig,
  type BlockSummary,
  type FixedWave,
  type PlanTeam,
  type PlannedWave,
  type ScheduleConflict,
  type SchedulePlan,
  type ScheduleTiming,
} from "@/lib/category-schedule";
import { orderedScheduleTeams } from "@/lib/wave-schedule";

// ─────────────────────────────────────────────────────────────────────────────
// THE PLANNER — lays the day out block by block under the rules in
// category-schedule.ts: fixed starts, breaks after the last wave finishes,
// protected waves kept exactly, and a day that does not fit reported as
// conflicts rather than bent. Pure, so the preview, the Waves screen and the
// server all get the same answer.
// ─────────────────────────────────────────────────────────────────────────────

/** The block a wave starting at `minutes` falls in: the last block started by then. */
export function blockAt(blocks: readonly BlockConfig[], minutes: number): Category | null {
  let found: Category | null = null;
  for (const block of [...blocks].sort((a, b) => a.position - b.position)) {
    if (clockMinutes(block.startTime) <= minutes) found = block.category;
  }
  return found;
}

/**
 * Lay out the day: protected waves exactly where they are, every other team
 * of the field (already filtered to those not running manually) in waves of
 * its own category's block, in the order Rookie, Open, Pro and team number,
 * each wave filled before the next starts.
 */
export function planCategorySchedule(input: {
  blocks: readonly BlockConfig[];
  timing: ScheduleTiming;
  teams: readonly PlanTeam[];
  fixed: readonly FixedWave[];
}): SchedulePlan {
  const blocks = [...input.blocks].sort((a, b) => a.position - b.position);
  const { timing } = input;
  const conflicts: ScheduleConflict[] = [];
  if (timing.waveMinutes <= 0) conflicts.push({ kind: "NO_ZONES" });
  const length = Math.max(1, timing.waveMinutes);
  const spacing = Math.max(1, timing.spacingMinutes);
  const startOf = new Map(blocks.map((block) => [block.category, clockMinutes(block.startTime)]));

  type Draft = Omit<PlannedWave, "number">;
  const drafts: Draft[] = [];

  // The protected waves, each in its block: the one it was built in, or —
  // for a wave built by hand — the block its start falls in.
  const fixed = input.fixed.map((wave) => {
    const startMinutes = clockMinutes(wave.startTime);
    const block = wave.blockCategory ?? blockAt(blocks, startMinutes);
    const numbers = wave.teams.map((team) => team.number);
    const beyond = wave.teams.filter((team) => team.station > timing.capacity).map((team) => team.number);
    if (beyond.length) conflicts.push({ kind: "PROTECTED_BEYOND_CAPACITY", waveNumber: wave.number, capacity: timing.capacity, teams: beyond });
    if (!block) {
      conflicts.push({ kind: "PROTECTED_OUTSIDE_SCHEDULE", waveNumber: wave.number, startTime: wave.startTime, teams: numbers });
    } else if (startMinutes < startOf.get(block)!) {
      conflicts.push({
        kind: "PROTECTED_BEFORE_BLOCK", category: block, waveNumber: wave.number, startTime: wave.startTime,
        blockStart: clockLabel(startOf.get(block)!), teams: numbers,
      });
    }
    const draft: Draft = {
      existingId: wave.id, previousNumber: wave.number, startMinutes, endMinutes: startMinutes + length,
      startTime: wave.startTime, block,
      seats: wave.teams.map((team) => ({ teamId: team.id, teamNumber: team.number, category: team.category, station: team.station, protected: true })),
    };
    return draft;
  });
  const fixedStarts = fixed.map((wave) => wave.startMinutes);

  const fill = (wave: Draft, queue: PlanTeam[]) => {
    const taken = new Set(wave.seats.map((seat) => seat.station));
    for (let station = 1; station <= timing.capacity && queue.length; station++) {
      if (taken.has(station)) continue;
      const team = queue.shift()!;
      wave.seats.push({ teamId: team.id, teamNumber: team.number, category: team.category, station, protected: false });
    }
  };
  // A new wave may not start within one spacing of a kept wave's start.
  const collides = (minutes: number) => fixedStarts.some((start) => start !== minutes && Math.abs(start - minutes) < spacing);

  for (const block of blocks) {
    const start = startOf.get(block.category)!;
    const queue = orderedScheduleTeams(input.teams.filter((team) => team.category === block.category));
    const kept = fixed.filter((wave) => wave.block === block.category).sort((a, b) => a.startMinutes - b.startMinutes);
    let next = 0;
    // Bounded: a day has at most DAY_MINUTES / spacing grid positions past its end.
    for (let k = 0; (queue.length || next < kept.length) && k <= 2 * DAY_MINUTES; k++) {
      const at = start + k * spacing;
      while (next < kept.length && kept[next].startMinutes < at) fill(kept[next++], queue);
      if (next < kept.length && kept[next].startMinutes === at) {
        fill(kept[next++], queue);
        continue;
      }
      if (!queue.length || collides(at)) continue;
      const wave: Draft = {
        existingId: null, previousNumber: null, startMinutes: at, endMinutes: at + length,
        startTime: clockLabel(at), block: block.category, seats: [],
      };
      fill(wave, queue);
      drafts.push(wave);
    }
    drafts.push(...kept);
  }
  // A protected wave with no block at all is still kept, exactly.
  drafts.push(...fixed.filter((wave) => !wave.block));

  const position = (category: Category | null) => blocks.find((block) => block.category === category)?.position ?? 99;
  const waves: PlannedWave[] = drafts
    .sort((a, b) => a.startMinutes - b.startMinutes || position(a.block) - position(b.block) || (a.existingId ? 0 : 1) - (b.existingId ? 0 : 1))
    .map((wave, index) => ({ ...wave, number: index + 1, seats: [...wave.seats].sort((a, b) => a.station - b.station) }));
  if (waves.length > MAX_WAVES) conflicts.push({ kind: "TOO_MANY_WAVES", waves: waves.length });

  const everyTeam = [...input.teams, ...input.fixed.flatMap((wave) => wave.teams)];
  const summaries: BlockSummary[] = blocks.map((block, index) => {
    const start = startOf.get(block.category)!;
    const inBlock = waves.filter((wave) => wave.block === block.category);
    const finish = inBlock.length ? Math.max(...inBlock.map((wave) => wave.endMinutes)) : null;
    const following = blocks[index + 1] ?? null;
    const seatsHere = inBlock.flatMap((wave) => wave.seats);
    const elsewhere = waves
      .filter((wave) => wave.block !== block.category)
      .flatMap((wave) => wave.seats)
      .filter((seat) => seat.category === block.category)
      .map((seat) => seat.teamNumber);
    return {
      category: block.category,
      position: block.position,
      startMinutes: start,
      breakMinutes: block.breakMinutes,
      teams: everyTeam.filter((team) => team.category === block.category).length,
      waves: inBlock.length,
      finishMinutes: finish,
      earliestNextMinutes: finish === null ? start : finish + block.breakMinutes,
      nextStartMinutes: following ? startOf.get(following.category)! : null,
      nextCategory: following?.category ?? null,
      hosting: seatsHere.filter((seat) => seat.category !== block.category).map((seat) => seat.teamNumber).sort((a, b) => a - b),
      elsewhere: elsewhere.sort((a, b) => a - b),
    };
  });

  for (const summary of summaries) {
    const inBlock = waves.filter((wave) => wave.block === summary.category);
    const protectedHere = inBlock.filter((wave) => wave.seats.some((seat) => seat.protected));
    if (summary.nextStartMinutes !== null && summary.nextCategory && summary.nextStartMinutes < summary.earliestNextMinutes) {
      const latestEnd = summary.nextStartMinutes - summary.breakMinutes;
      const wavesInTime = latestEnd - length >= summary.startMinutes ? Math.floor((latestEnd - length - summary.startMinutes) / spacing) + 1 : 0;
      const protectedSeats = protectedHere.flatMap((wave) => wave.seats.filter((seat) => seat.protected)).length;
      conflicts.push({
        kind: "OVERRUN",
        category: summary.category,
        nextCategory: summary.nextCategory,
        finishMinutes: summary.finishMinutes ?? summary.startMinutes,
        breakMinutes: summary.breakMinutes,
        earliestNextMinutes: summary.earliestNextMinutes,
        nextStartMinutes: summary.nextStartMinutes,
        shortByMinutes: summary.earliestNextMinutes - summary.nextStartMinutes,
        requiredMinutes: summary.earliestNextMinutes - summary.startMinutes,
        availableMinutes: summary.nextStartMinutes - summary.startMinutes,
        teamsToPlace: inBlock.flatMap((wave) => wave.seats).filter((seat) => !seat.protected).length,
        placesInTime: Math.max(0, wavesInTime * timing.capacity - protectedSeats),
        protectedWaves: protectedHere.filter((wave) => wave.endMinutes + summary.breakMinutes > summary.nextStartMinutes!).map((wave) => wave.number),
      });
    }
    if (summary.finishMinutes !== null && summary.finishMinutes > DAY_MINUTES) {
      conflicts.push({
        kind: "PAST_MIDNIGHT", category: summary.category, finishMinutes: summary.finishMinutes,
        protectedWaves: protectedHere.filter((wave) => wave.endMinutes > DAY_MINUTES).map((wave) => wave.number),
      });
    }
  }

  return { waves, blocks: summaries, conflicts };
}
