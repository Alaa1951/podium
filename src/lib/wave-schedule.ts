import type { Category, Division } from "@/generated/prisma/enums";

/** Running order, independent of the results board's display order. */
export const SCHEDULE_CATEGORIES = ["Mens", "Mixed", "Womens"] as const;
export const SCHEDULE_DIVISIONS = ["Rookie", "Open", "Pro"] as const;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ScheduleError extends Error {}

export function scheduledTime(firstWaveTime: string, intervalMinutes: number, index: number): string {
  if (!TIME_PATTERN.test(firstWaveTime) || !Number.isInteger(intervalMinutes) || intervalMinutes < 1 ||
      intervalMinutes > 1440 || !Number.isInteger(index) || index < 0) {
    throw new ScheduleError("INVALID_INPUT");
  }
  const [hours, minutes] = firstWaveTime.split(":").map(Number);
  const total = hours * 60 + minutes + intervalMinutes * index;
  if (total >= 1440) throw new ScheduleError("SCHEDULE_EXCEEDS_DAY");
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function orderedScheduleTeams<T extends { category: Category; division: Division; number: number }>(teams: T[]): T[] {
  return [...teams].sort((a, b) =>
    SCHEDULE_CATEGORIES.indexOf(a.category) - SCHEDULE_CATEGORIES.indexOf(b.category) ||
    SCHEDULE_DIVISIONS.indexOf(a.division) - SCHEDULE_DIVISIONS.indexOf(b.division) || a.number - b.number);
}

export function assignmentPlan<T extends { category: Category; division: Division; number: number }>(teams: T[], capacity: number) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 9) throw new ScheduleError("INVALID_INPUT");
  if (Math.ceil(teams.length / capacity) > 99) throw new ScheduleError("TOO_MANY_WAVES");
  return orderedScheduleTeams(teams).map((team, index) => ({
    team, number: Math.floor(index / capacity) + 1, station: index % capacity + 1,
  }));
}

export function scheduleError(error: unknown): { ok: false; error: string } {
  if (error instanceof ScheduleError) return { ok: false, error: error.message };
  if (error && typeof error === "object" && "code" in error &&
      ["P2002", "P2025", "P2034"].includes(String(error.code))) return { ok: false, error: "SCHEDULE_CHANGED" };
  throw error;
}
