import "server-only";

import { awardsWindows, type AwardsWindow, type BlockConfig, type FixedWave, type PlanTeam, type SchedulePlan, type ScheduleTiming } from "@/lib/category-schedule";
import { blocksGovern, fixedWaves, isProtected, isScheduled, loadScheduleContext, planFor } from "@/lib/category-schedule-db";
import { prisma } from "@/lib/prisma";

/**
 * What the Settings preview and the Waves screen show about the category
 * schedule: the blocks as saved, the timing and field the planner works
 * from, what Auto Assign would do if it ran now, and each category's
 * planned awards period from the waves as they stand.
 */
export type ScheduleView = {
  blocks: BlockConfig[];
  /** Every category has a start and a break. */
  scheduled: boolean;
  /** Settings → Category schedule › Auto Assign. */
  autoAssign: boolean;
  /** Auto Assign on and the schedule complete: blocks and running-manually rules apply. */
  governs: boolean;
  timing: ScheduleTiming;
  /** The field not running manually. */
  teams: PlanTeam[];
  fixed: FixedWave[];
  /** Null until every category has a start and a break, and while Auto Assign is off. */
  plan: SchedulePlan | null;
  awards: AwardsWindow[];
};

export async function loadScheduleView(seriesId: string): Promise<ScheduleView> {
  const context = await loadScheduleContext(prisma, seriesId);
  const scheduled = isScheduled(context.blocks);
  const governs = blocksGovern(context.autoAssign, context.blocks);
  const held = new Set(context.teams.filter((team) => isProtected(team, context.waves)).map((team) => team.id));
  return {
    blocks: context.blocks,
    scheduled,
    autoAssign: context.autoAssign,
    governs,
    timing: context.timing,
    teams: context.teams.filter((team) => !held.has(team.id)).map(({ id, number, category, division }) => ({ id, number, category, division })),
    fixed: fixedWaves(context),
    plan: governs ? planFor(context) : null,
    awards: governs ? awardsWindows(context.blocks, context.waves) : [],
  };
}
