import type { Category, Division } from "@/generated/prisma/enums";
import { waveLengthMinutes } from "@/lib/floor";
import { SCHEDULE_CATEGORIES, TIME_PATTERN } from "@/lib/wave-schedule";

// ─────────────────────────────────────────────────────────────────────────────
// THE CATEGORY SCHEDULE — Men, Mixed and Women each in a block of the day.
//
// A block starts at its configured time (a FIXED constraint), holds only its
// own category's waves, and ends when its last wave FINISHES — not when that
// wave starts. Then comes at least its configured break, for awards and
// preparation, before the next block may start.
//
// The waves inside a block follow the floor's own rules (floor.ts), so the
// estimate is the day as it will run:
//   · a wave lasts every zone's work plus the changeovers between them;
//   · waves start one "spacing" apart: the competition's interval between
//     starts, or the time Zone 1 is busy with the wave before — whichever is
//     longer, because a wave cannot start while Zone 1 is taken;
//   · each wave holds the competition's teams per wave, one per station.
//
// RUNNING MANUALLY. A team staff placed by hand is PROTECTED: it keeps its
// exact wave, time and station, and its station counts as taken before
// anybody else is placed. A wave holding such a team is kept as it is; new
// waves are laid around it. A protected team may stand in another
// category's block — a scheduling exception that changes nothing about the
// category it competes and is ranked in.
//
// Nothing here moves a start time, shortens a break, or spills a category
// into another block to make a day fit. A day that does not fit comes back as
// CONFLICTS, each saying what it needs and what it has, for a person to
// resolve.
//
// Pure: the settings preview, the Waves screen and the server all ask this,
// so what a person is shown is what will be saved.
// ─────────────────────────────────────────────────────────────────────────────

export const DAY_MINUTES = 24 * 60;
export const MAX_BREAK_MINUTES = 12 * 60;
export const MAX_WAVES = 99;

/** One category's block, as configured in Settings → Category schedule. */
export type BlockConfig = {
  category: Category;
  /** 1-based running order of the blocks. */
  position: number;
  /** "HH:mm", Qatar wall time on the competition's day. */
  startTime: string;
  breakMinutes: number;
};

/** The default running order, before anybody sets one. No times are invented. */
export const DEFAULT_BLOCK_ORDER: Category[] = [...SCHEDULE_CATEGORIES];

export function clockMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

/** "HH:mm" — past midnight it says so, rather than wrapping to the morning. */
export function clockLabel(minutes: number): string {
  const day = Math.floor(minutes / DAY_MINUTES);
  const within = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const label = `${String(Math.floor(within / 60)).padStart(2, "0")}:${String(within % 60).padStart(2, "0")}`;
  return day > 0 ? `${label} (+${day})` : label;
}

export type ScheduleTiming = {
  /** One wave, start to finish: every zone's work plus the changeovers between. */
  waveMinutes: number;
  /** How long Zone 1 is busy with a wave — the soonest the next may start. */
  slotMinutes: number;
  /** Between two waves' starts in a block: the interval, or the Zone 1 slot if longer. */
  spacingMinutes: number;
  /** Teams per wave: one per station. */
  capacity: number;
};

export function scheduleTiming(
  series: { waveIntervalMinutes: number; zoneWorkMinutes: number; zoneBreakMinutes: number },
  zoneCount: number,
  capacity: number
): ScheduleTiming {
  const timing = { workMinutes: series.zoneWorkMinutes, breakMinutes: series.zoneBreakMinutes, zoneCount };
  const slotMinutes = series.zoneWorkMinutes + (zoneCount > 1 ? series.zoneBreakMinutes : 0);
  return {
    waveMinutes: waveLengthMinutes(timing),
    slotMinutes,
    spacingMinutes: Math.max(series.waveIntervalMinutes, slotMinutes),
    capacity,
  };
}

export type ConfigError = "CATEGORY_SCHEDULE_INCOMPLETE" | "INVALID_INPUT";

/** Every category exactly once, a running order 1–3, a real clock time and a break 0–720 minutes. */
export function validateBlockConfig(rows: readonly BlockConfig[]): { ok: true; blocks: BlockConfig[] } | { ok: false; error: ConfigError } {
  const categories = new Set(rows.map((row) => row.category));
  if (rows.length !== SCHEDULE_CATEGORIES.length || SCHEDULE_CATEGORIES.some((category) => !categories.has(category))) {
    return { ok: false, error: "CATEGORY_SCHEDULE_INCOMPLETE" };
  }
  const positions = rows.map((row) => row.position).sort((a, b) => a - b);
  if (positions.some((position, index) => position !== index + 1)) return { ok: false, error: "INVALID_INPUT" };
  for (const row of rows) {
    if (!TIME_PATTERN.test(row.startTime)) return { ok: false, error: "INVALID_INPUT" };
    if (!Number.isInteger(row.breakMinutes) || row.breakMinutes < 0 || row.breakMinutes > MAX_BREAK_MINUTES) {
      return { ok: false, error: "INVALID_INPUT" };
    }
  }
  return { ok: true, blocks: [...rows].sort((a, b) => a.position - b.position) };
}

// ── What a plan says (the planner itself: category-schedule-plan.ts) ─────────

export type PlanTeam = { id: string; number: number; category: Category; division: Division };
/** A team running manually, where it stands. */
export type ProtectedTeam = PlanTeam & { station: number };
/** A wave holding at least one protected team: kept exactly as it is. */
export type FixedWave = { id: string; number: number; startTime: string; blockCategory: Category | null; teams: ProtectedTeam[] };

export type PlannedSeat = { teamId: string; teamNumber: number; category: Category; station: number; protected: boolean };

export type PlannedWave = {
  /** The existing wave kept (a protected one), or null for a wave to create. */
  existingId: string | null;
  /** The wave's number before this plan, for an existing one. */
  previousNumber: number | null;
  /** Final running-order number: chronological. */
  number: number;
  startMinutes: number;
  endMinutes: number;
  startTime: string;
  block: Category | null;
  seats: PlannedSeat[];
};

export type BlockSummary = {
  category: Category;
  position: number;
  startMinutes: number;
  breakMinutes: number;
  /** Every team of this category in the field, wherever it runs. */
  teams: number;
  waves: number;
  /** When the block's last wave finishes; null when nothing runs in it. */
  finishMinutes: number | null;
  /** The earliest the next block may start: finish plus the break. */
  earliestNextMinutes: number;
  /** The next block's configured start; null for the last block. */
  nextStartMinutes: number | null;
  nextCategory: Category | null;
  /** Numbers of teams of OTHER categories running in this block. */
  hosting: number[];
  /** Numbers of this category's teams running outside this block. */
  elsewhere: number[];
};

export type ScheduleConflict =
  | { kind: "NO_ZONES" }
  | { kind: "TOO_MANY_WAVES"; waves: number }
  | {
      kind: "OVERRUN";
      category: Category;
      nextCategory: Category;
      finishMinutes: number;
      breakMinutes: number;
      earliestNextMinutes: number;
      nextStartMinutes: number;
      shortByMinutes: number;
      /** From the block's start: its competition plus its break. */
      requiredMinutes: number;
      /** From the block's start to the next block's start. */
      availableMinutes: number;
      /** Teams still to place in this block, and how many places fit in time. */
      teamsToPlace: number;
      placesInTime: number;
      /** Waves holding teams running manually that finish too late on their own. */
      protectedWaves: number[];
    }
  | { kind: "PAST_MIDNIGHT"; category: Category; finishMinutes: number; protectedWaves: number[] }
  | { kind: "PROTECTED_BEFORE_BLOCK"; category: Category; waveNumber: number; startTime: string; blockStart: string; teams: number[] }
  | { kind: "PROTECTED_OUTSIDE_SCHEDULE"; waveNumber: number; startTime: string; teams: number[] }
  | { kind: "PROTECTED_BEYOND_CAPACITY"; waveNumber: number; capacity: number; teams: number[] };

/** Whether a conflict involves a team running manually — a person must resolve it first. */
export function touchesProtected(conflict: ScheduleConflict): boolean {
  switch (conflict.kind) {
    case "PROTECTED_BEFORE_BLOCK":
    case "PROTECTED_OUTSIDE_SCHEDULE":
    case "PROTECTED_BEYOND_CAPACITY":
      return true;
    case "OVERRUN":
    case "PAST_MIDNIGHT":
      return conflict.protectedWaves.length > 0;
    default:
      return false;
  }
}

export type SchedulePlan = {
  waves: PlannedWave[];
  blocks: BlockSummary[];
  conflicts: ScheduleConflict[];
};

// ── Exceptions and awards ────────────────────────────────────────────────────

/** A team standing in a block that is not its own category's — or in no block, once there is a schedule. */
export function outsideItsBlock(teamCategory: Category, waveBlock: Category | null, scheduled: boolean): boolean {
  return scheduled && waveBlock !== teamCategory;
}

/**
 * A PRIVACY REVIEW, for BFT MENA before the wave: the waiver keeps the women's
 * competition free of any photography or recording (§8) while the men's and
 * mixed portions may be filmed (§9). A Women's team in a men's or mixed block,
 * or a men's or mixed team in the women's block, is where the two meet.
 * Flagged, never resolved by the app: a move changes no category and gives
 * no media consent.
 */
export function privacyReview(teamCategory: Category, hostBlock: Category | null): boolean {
  if (!hostBlock || hostBlock === teamCategory) return false;
  return (teamCategory === "Womens") !== (hostBlock === "Womens");
}

export type AwardsWindow = { category: Category; fromMinutes: number; toMinutes: number };

/**
 * Each category's planned awards period, from the waves as they stand: from
 * when its block's last wave finishes, for its configured break.
 */
export function awardsWindows(
  blocks: readonly BlockConfig[],
  waves: readonly { startTime: string; durationMinutes: number; blockCategory: Category | null }[]
): AwardsWindow[] {
  return blocks.flatMap((block) => {
    const ends = waves.filter((wave) => wave.blockCategory === block.category).map((wave) => clockMinutes(wave.startTime) + wave.durationMinutes);
    if (!ends.length) return [];
    const from = Math.max(...ends);
    return [{ category: block.category, fromMinutes: from, toMinutes: from + block.breakMinutes }];
  });
}

/**
 * The awards period a team would miss by running in a wave that finishes
 * after its category's competition has ended — its category's results would
 * not be complete when the awards begin. Null when there is none.
 */
export function lateForAwards(teamCategory: Category, waveEndMinutes: number, windows: readonly AwardsWindow[]): AwardsWindow | null {
  const window = windows.find((one) => one.category === teamCategory);
  return window && waveEndMinutes > window.fromMinutes ? window : null;
}
