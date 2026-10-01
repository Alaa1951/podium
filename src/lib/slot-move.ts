import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Category } from "@/generated/prisma/enums";
import { awardsWindows, clockLabel, clockMinutes, lateForAwards, outsideItsBlock, type AwardsWindow } from "@/lib/category-schedule";
import { isScheduled, loadBlocks } from "@/lib/category-schedule-db";
import { lowestFreeStation } from "@/lib/floor";
import { ScheduleError } from "@/lib/wave-schedule";

// ─────────────────────────────────────────────────────────────────────────────
// MOVING ONE TEAM BY HAND — the rules every manual placement meets, whether
// staff move it on the Waves screen or approve an athlete's time change.
//
// A manual move MAY put a team in another category's block (or in a wave
// outside the schedule): a scheduling exception, which changes nothing about
// the category it competes, is ranked and is awarded in. It must be
// confirmed as such. So must a slot that finishes after the team's own
// category has finished — its results would not be complete when that
// category's awards begin.
//
// It may NOT bypass anything else: the destination must be a wave that has
// not started, with a free station inside its capacity — or the station of
// another team, which then takes the mover's slot (an EXCHANGE: no wave
// holds more teams than before); both teams must be in the field, not
// scored, and still where the page showed them.
// ─────────────────────────────────────────────────────────────────────────────

export type SlotWarnings = {
  /** The destination is not the team's own category block. */
  exception: { hostBlock: Category | null } | null;
  /** The destination finishes after the team's category's awards period begins. */
  awards: (AwardsWindow & { finishesAt: string; from: string; to: string }) | null;
};

type Target = { id: string; seriesId: string; number: number; status: string; capacity: number; startTime: string; durationMinutes: number; blockCategory: Category | null };

/** What confirming a move to `target` would mean for a team of `category`. */
export async function slotWarnings(tx: Prisma.TransactionClient, category: Category, target: Target): Promise<SlotWarnings> {
  const blocks = await loadBlocks(tx, target.seriesId);
  const scheduled = isScheduled(blocks);
  const exception = outsideItsBlock(category, target.blockCategory, scheduled) ? { hostBlock: target.blockCategory } : null;
  if (!scheduled) return { exception, awards: null };
  const waves = await tx.wave.findMany({ where: { seriesId: target.seriesId }, select: { startTime: true, durationMinutes: true, blockCategory: true } });
  const end = clockMinutes(target.startTime) + target.durationMinutes;
  const late = lateForAwards(category, end, awardsWindows(blocks, waves));
  return {
    exception,
    awards: late ? { ...late, finishesAt: clockLabel(end), from: clockLabel(late.fromMinutes), to: clockLabel(late.toMinutes) } : null,
  };
}

type ConfirmationCode = "EXCEPTION_UNCONFIRMED" | "AWARDS_UNCONFIRMED" | "SWAP_EXCEPTION_UNCONFIRMED" | "SWAP_AWARDS_UNCONFIRMED";

/** Thrown when a move needs an explicit confirmation it did not carry. */
export class SlotConfirmationError extends Error {
  constructor(readonly code: ConfirmationCode, readonly warnings: SlotWarnings) {
    super(code);
  }
}

/** `swap`: the warnings are for the team the mover exchanges slots with. */
export function requireConfirmations(warnings: SlotWarnings, confirmed: { exception?: boolean; awards?: boolean }, swap = false) {
  if (warnings.exception && !confirmed.exception) throw new SlotConfirmationError(swap ? "SWAP_EXCEPTION_UNCONFIRMED" : "EXCEPTION_UNCONFIRMED", warnings);
  if (warnings.awards && !confirmed.awards) throw new SlotConfirmationError(swap ? "SWAP_AWARDS_UNCONFIRMED" : "AWARDS_UNCONFIRMED", warnings);
}

/**
 * Who holds a wave's stations: teams in the field only. A withdrawn team
 * keeps its wave but gives its station back (team-people.ts › archiveTeam),
 * and a team on the waiting list holds no place — neither fills a wave, here
 * as on the screen, in CRM admission and on Wave control.
 */
export const IN_FIELD = { archivedAt: null, waitlistedAt: null } as const;

/**
 * The station a team takes in `target`: the one asked for, or the lowest
 * free one. Refuses a full wave, a station past its capacity or taken by
 * another team.
 */
export async function claimStation(tx: Prisma.TransactionClient, target: Target, teamId: string, asked: number | null): Promise<number> {
  if (target.status !== "pending") throw new ScheduleError("WAVE_STARTED");
  const others = await tx.team.findMany({ where: { waveId: target.id, NOT: { id: teamId }, ...IN_FIELD }, select: { station: true } });
  if (others.length >= target.capacity) throw new ScheduleError("WAVE_FULL");
  const taken = others.map((row) => row.station);
  if (asked !== null) {
    if (asked > target.capacity) throw new ScheduleError("BEYOND_CAPACITY");
    if (taken.includes(asked)) throw new ScheduleError("STATION_TAKEN");
    return asked;
  }
  const station = lowestFreeStation(taken, target.capacity);
  if (station === null) throw new ScheduleError("WAVE_FULL");
  return station;
}

/** "wave 3 (Mixed block, 12:00) station 2" — a slot as the audit trail reads it. */
export function slotLabel(wave: { number: number; startTime: string; blockCategory: Category | null } | null, station: number | null): string {
  if (!wave) return "no wave";
  return `wave ${wave.number} (${wave.blockCategory ? `${wave.blockCategory} block` : "no category block"}, ${wave.startTime}) station ${station ?? "—"}`;
}
