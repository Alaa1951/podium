import "server-only";

import { awardsWindows, type AwardsWindow, type BlockConfig, type FixedWave, type PlanTeam, type SchedulePlan, type ScheduleTiming } from "@/lib/category-schedule";
import { fixedWaves, isProtected, isScheduled, loadScheduleContext, planFor } from "@/lib/category-schedule-db";
import { prisma } from "@/lib/prisma";

/**
 * What the Settings preview and the Waves screen show about the category
 * schedule: the blocks as saved, the timing and field the planner works
 * from, what Auto Assign would do if it ran now, and each category's
 * planned awards period from the waves as they stand.
 */
export type ScheduleView = {
  blocks: BlockConfig[];
  scheduled: boolean;
  timing: ScheduleTiming;
  /** The field not running manually. */
  teams: PlanTeam[];
  fixed: FixedWave[];
  /** Null until every category has a start and a break. */
  plan: SchedulePlan | null;
  awards: AwardsWindow[];
};

export async function loadScheduleView(seriesId: string): Promise<ScheduleView> {
  const context = await loadScheduleContext(prisma, seriesId);
  const scheduled = isScheduled(context.blocks);
  const held = new Set(context.teams.filter((team) => isProtected(team, context.waves)).map((team) => team.id));
  return {
    blocks: context.blocks,
    scheduled,
    timing: context.timing,
    teams: context.teams.filter((team) => !held.has(team.id)).map(({ id, number, category, division }) => ({ id, number, category, division })),
    fixed: fixedWaves(context),
    plan: scheduled ? planFor(context) : null,
    awards: scheduled ? awardsWindows(context.blocks, context.waves) : [],
  };
}
