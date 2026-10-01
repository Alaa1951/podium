import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Category } from "@/generated/prisma/enums";
import {
  scheduleTiming,
  validateBlockConfig,
  type BlockConfig,
  type FixedWave,
  type PlanTeam,
  type ScheduleConflict,
  type SchedulePlan,
  type ScheduleTiming,
} from "@/lib/category-schedule";
import { planCategorySchedule } from "@/lib/category-schedule-plan";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// Reading what the category planner needs, and writing what it decided.
// Every write here runs inside the caller's scheduleTransaction — the
// competition row and its waves already locked — so what is read is what is
// current, and a manual move and an Auto Assign run can never interleave.
// ─────────────────────────────────────────────────────────────────────────────

type Db = Prisma.TransactionClient | typeof prisma;

/** The competition's category blocks in running order; empty until somebody sets them. */
export async function loadBlocks(db: Db, seriesId: string): Promise<BlockConfig[]> {
  const rows = await db.categorySchedule.findMany({
    where: { seriesId },
    orderBy: { position: "asc" },
    select: { category: true, position: true, startTime: true, breakMinutes: true },
  });
  return rows;
}

/** A complete, valid schedule — the condition for category-aware Auto Assign. */
export function isScheduled(blocks: readonly BlockConfig[]): boolean {
  return validateBlockConfig(blocks).ok;
}

/**
 * Whether the category blocks and teams running manually GOVERN changes:
 * Auto Assign is switched on (Series.autoAssignEnabled) and the schedule is
 * complete. Off, the running order is built by hand — no block exception or
 * awards warning to confirm, no protected team in the way.
 */
export function blocksGovern(autoAssign: boolean, blocks: readonly BlockConfig[]): boolean {
  return autoAssign && isScheduled(blocks);
}

/** Settings → Category schedule › Auto Assign, for this competition. */
export async function autoAssignOn(db: Db, seriesId: string): Promise<boolean> {
  const series = await db.series.findUnique({ where: { id: seriesId }, select: { autoAssignEnabled: true } });
  return series?.autoAssignEnabled ?? true;
}

export type ScheduleWave = {
  id: string;
  number: number;
  startTime: string;
  durationMinutes: number;
  capacity: number;
  status: "pending" | "running" | "complete";
  blockCategory: Category | null;
};

export type ScheduleTeam = PlanTeam & {
  name: string;
  waveId: string | null;
  station: number | null;
  slotManualAt: Date | null;
};

export type ScheduleContext = {
  seriesId: string;
  /** Settings → Category schedule › Auto Assign. */
  autoAssign: boolean;
  blocks: BlockConfig[];
  timing: ScheduleTiming;
  waves: ScheduleWave[];
  /** The field: not withdrawn, not on the waiting list. */
  teams: ScheduleTeam[];
};

export type TimingOverrides = Partial<{
  capacity: number;
  waveIntervalMinutes: number;
  zoneWorkMinutes: number;
  zoneBreakMinutes: number;
}>;

export async function loadScheduleContext(db: Db, seriesId: string, overrides: TimingOverrides = {}): Promise<ScheduleContext> {
  const [series, zoneCount, blocks, waves, teams] = await Promise.all([
    db.series.findUniqueOrThrow({
      where: { id: seriesId },
      select: { waveIntervalMinutes: true, zoneWorkMinutes: true, zoneBreakMinutes: true, waveCapacity: true, autoAssignEnabled: true },
    }),
    db.zone.count({ where: { seriesId } }),
    loadBlocks(db, seriesId),
    db.wave.findMany({
      where: { seriesId },
      orderBy: { number: "asc" },
      select: { id: true, number: true, startTime: true, durationMinutes: true, capacity: true, status: true, blockCategory: true },
    }),
    db.team.findMany({
      where: { seriesId, archivedAt: null, waitlistedAt: null },
      orderBy: { number: "asc" },
      select: { id: true, number: true, name: true, category: true, division: true, waveId: true, station: true, slotManualAt: true },
    }),
  ]);
  const timing = scheduleTiming(
    {
      waveIntervalMinutes: overrides.waveIntervalMinutes ?? series.waveIntervalMinutes,
      zoneWorkMinutes: overrides.zoneWorkMinutes ?? series.zoneWorkMinutes,
      zoneBreakMinutes: overrides.zoneBreakMinutes ?? series.zoneBreakMinutes,
    },
    zoneCount,
    overrides.capacity ?? series.waveCapacity
  );
  return { seriesId, autoAssign: series.autoAssignEnabled, blocks, timing, waves, teams };
}

/**
 * Whether a team is RUNNING MANUALLY and so held where it is: placed by
 * hand, and still standing on a station of a wave that has not started.
 */
export function isProtected(team: Pick<ScheduleTeam, "slotManualAt" | "waveId" | "station">, waves: readonly ScheduleWave[]): boolean {
  if (!team.slotManualAt || !team.waveId || team.station === null) return false;
  return waves.some((wave) => wave.id === team.waveId && wave.status === "pending");
}

/** The waves holding protected teams, as the planner keeps them. */
export function fixedWaves(context: Pick<ScheduleContext, "waves" | "teams">): FixedWave[] {
  const held = context.teams.filter((team) => isProtected(team, context.waves));
  return context.waves
    .filter((wave) => held.some((team) => team.waveId === wave.id))
    .map((wave) => ({
      id: wave.id,
      number: wave.number,
      startTime: wave.startTime,
      blockCategory: wave.blockCategory,
      teams: held
        .filter((team) => team.waveId === wave.id)
        .map((team) => ({ id: team.id, number: team.number, category: team.category, division: team.division, station: team.station! })),
    }));
}

/** The plan for this competition as it stands — protected teams held, everyone else to place. */
export function planFor(context: ScheduleContext, blocks: readonly BlockConfig[] = context.blocks): SchedulePlan {
  const held = new Set(context.teams.filter((team) => isProtected(team, context.waves)).map((team) => team.id));
  return planCategorySchedule({
    blocks,
    timing: context.timing,
    teams: context.teams.filter((team) => !held.has(team.id)),
    fixed: fixedWaves(context),
  });
}

/** Thrown inside a transaction to leave everything as it was and report why. */
export class ScheduleConflictError extends Error {
  constructor(readonly code: "SCHEDULE_CONFLICT" | "PROTECTED_CONFLICT", readonly conflicts: ScheduleConflict[]) {
    super(code);
  }
}

/**
 * Write a conflict-free plan. The caller has checked every wave is pending.
 *
 *   1. every team not running manually lets go of its wave and station —
 *      withdrawn and waiting teams included, which must hold no place;
 *   2. every wave that holds no protected team is removed;
 *   3. the protected waves stay — same row, same time, same stations — and
 *      only take their new number in the running order and today's length
 *      and capacity;
 *   4. the new waves are created and the teams seated.
 *
 * A protected team is never written except for the wave NUMBER it shows,
 * which follows the running order.
 */
export async function applyPlan(
  tx: Prisma.TransactionClient,
  context: ScheduleContext,
  plan: SchedulePlan
): Promise<{ created: number; kept: number; renumbered: number }> {
  const seriesId = context.seriesId;
  const held = new Set(context.teams.filter((team) => isProtected(team, context.waves)).map((team) => team.id));
  const keptIds = plan.waves.flatMap((wave) => (wave.existingId ? [wave.existingId] : []));

  await tx.team.updateMany({
    where: { seriesId, id: { notIn: [...held] }, OR: [{ waveId: { not: null } }, { station: { not: null } }] },
    data: { waveId: null, station: null },
  });
  await tx.wave.deleteMany({ where: { seriesId, id: { notIn: keptIds } } });
  // Out of the way of the final numbers first: (seriesId, number) is unique.
  for (const [index, id] of keptIds.entries()) await tx.wave.update({ where: { id }, data: { number: 1000 + index } });

  const waveMinutes = Math.max(1, context.timing.waveMinutes);
  let renumbered = 0;
  for (const wave of plan.waves) {
    const data = { number: wave.number, capacity: context.timing.capacity, durationMinutes: waveMinutes, blockCategory: wave.block };
    const id = wave.existingId
      ? (await tx.wave.update({ where: { id: wave.existingId }, data, select: { id: true } })).id
      : (await tx.wave.create({ data: { ...data, seriesId, startTime: wave.startTime }, select: { id: true } })).id;
    if (wave.existingId && wave.previousNumber !== wave.number) renumbered += 1;
    for (const seat of wave.seats) {
      await tx.team.update({
        where: { id: seat.teamId },
        // A protected team keeps its wave and station; only the number it shows follows the order.
        data: seat.protected ? { wave: wave.number } : { waveId: id, wave: wave.number, station: seat.station },
      });
    }
  }
  return { created: plan.waves.filter((wave) => !wave.existingId).length, kept: keptIds.length, renumbered };
}
