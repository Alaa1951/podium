"use server";

import { z } from "zod";

import { canPlaceTeams } from "@/lib/access";
import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { getCurrentUser, teamScope } from "@/lib/session";
import { clearReadiness } from "@/lib/checkin-db";
import { claimStation, IN_FIELD, requireConfirmations, SlotConfirmationError, slotLabel, slotWarnings, type SlotWarnings } from "@/lib/slot-move";
import { ScheduleError, scheduleError } from "@/lib/wave-schedule";
import { scheduleTransaction } from "@/lib/wave-schedule-db";

// ─────────────────────────────────────────────────────────────────────────────
// The two buttons of a manual placement on the Waves screen:
//
//   moveTeam            put a team in a chosen slot by hand — it then RUNS
//                       MANUALLY, and Auto Assign leaves it exactly there;
//   returnToAutoAssign  hand it back: its protection goes, its slot stays
//                       until the next Auto Assign run reseats it.
//
// `waves.placeTeams`, within the account's own teams (teamScope); never an
// athlete's account, never the Judge role (access.ts › canPlaceTeams). The
// rules of a move are slot-move.ts. Both run under the competition lock, so
// neither can interleave with an Auto Assign run.
// ─────────────────────────────────────────────────────────────────────────────

export type SlotActionResult =
  | { ok: true }
  | { ok: false; error: string; warnings?: SlotWarnings };

const moveSchema = z.object({
  teamId: z.string().min(1).max(191),
  waveId: z.string().min(1).max(191),
  /** A chosen station, or null for the lowest free one. */
  station: z.number().int().min(1).max(9).nullable(),
  /** Where the page showed the team: a move made from a stale page is refused. */
  expectedWaveId: z.string().max(191).nullable(),
  expectedStation: z.number().int().min(1).max(9).nullable(),
  /** Staff confirmed a slot outside the team's own category block. */
  confirmException: z.boolean().default(false),
  /** Staff confirmed a slot finishing after the team's category's awards begin. */
  confirmAwards: z.boolean().default(false),
  /**
   * The team the page showed on the chosen station: the two EXCHANGE slots.
   * How a team gets into a full wave, or onto a taken station of its own.
   */
  swapTeamId: z.string().min(1).max(191).nullable().default(null),
  /** The same two confirmations, for the team taking the mover's slot. */
  confirmSwapException: z.boolean().default(false),
  confirmSwapAwards: z.boolean().default(false),
});

type Moved = { teamId: string; label: string; detail: string };

/** Why a slot is exceptional, for the audit line. */
function notesFor(team: { category: string; division: string }, warnings: SlotWarnings): string[] {
  return [
    "running manually",
    warnings.exception
      ? `exception: ${team.category} team in ${warnings.exception.hostBlock ? `the ${warnings.exception.hostBlock} block` : "no category block"} (still competes and is ranked as ${team.category} ${team.division})`
      : null,
    warnings.awards ? `finishes ${warnings.awards.finishesAt}, after the ${team.category} awards period begins (${warnings.awards.from}–${warnings.awards.to}) — confirmed` : null,
  ].filter((note): note is string => Boolean(note));
}

const NO_WARNINGS: SlotWarnings = { exception: null, awards: null };

export async function moveTeam(input: unknown): Promise<SlotActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "UNAUTHENTICATED" };
  if (actor.viewAs || !canPlaceTeams(actor)) return { ok: false, error: "FORBIDDEN" };
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const data = parsed.data;

  const where = { id: data.teamId, archivedAt: null, ...teamScope(actor) };
  const found = await prisma.team.findFirst({ where, select: { seriesId: true } });
  if (!found) return { ok: false, error: "NOT_FOUND" };
  let moved: Moved[];
  try {
    moved = await scheduleTransaction(found.seriesId, async (tx) => {
      const scored = async (teamId: string) => (await tx.zoneScore.count({ where: { status: "submitted", score: { teamId } } })) > 0;
      const team = await tx.team.findFirst({ where, include: { waveRef: true, series: { select: { name: true, status: true, archivedAt: true } } } });
      if (!team || team.series.archivedAt) throw new ScheduleError("NOT_FOUND");
      if (team.series.status === "final") throw new ScheduleError("SERIES_FINISHED");
      if (team.waitlistedAt) throw new ScheduleError("ON_THE_WAITING_LIST");
      if (team.waveId !== data.expectedWaveId || team.station !== data.expectedStation) throw new ScheduleError("SCHEDULE_CHANGED");
      // The team's OWN wave: once it has started the team has run (or missed) it.
      if (team.waveRef && team.waveRef.status !== "pending") throw new ScheduleError("TEAM_WAVE_STARTED");
      if (await scored(team.id)) throw new ScheduleError("TEAM_ALREADY_SCORED");

      const target = await tx.wave.findFirst({ where: { id: data.waveId, seriesId: team.seriesId } });
      if (!target) throw new ScheduleError("SCHEDULE_CHANGED");
      if (target.status !== "pending") throw new ScheduleError("WAVE_STARTED");

      // An exchange: the team the page showed on that station takes the mover's slot.
      let partner: (typeof team & { waveRef: typeof team.waveRef }) | null = null;
      let station: number;
      if (data.swapTeamId) {
        if (data.station === null) throw new ScheduleError("INVALID_INPUT");
        if (!team.waveRef || team.station === null) throw new ScheduleError("SWAP_NEEDS_SLOT");
        if (data.station > target.capacity) throw new ScheduleError("BEYOND_CAPACITY");
        const occupant = await tx.team.findFirst({ where: { waveId: target.id, station: data.station, ...IN_FIELD }, select: { id: true } });
        if (!occupant || occupant.id !== data.swapTeamId) throw new ScheduleError("SCHEDULE_CHANGED");
        if (occupant.id === team.id) throw new ScheduleError("SAME_SLOT");
        // Within the mover's own teams (a gym never shifts another gym's team).
        partner = await tx.team.findFirst({ where: { id: occupant.id, ...teamScope(actor) }, include: { waveRef: true, series: { select: { name: true, status: true, archivedAt: true } } } });
        if (!partner) throw new ScheduleError("STATION_TAKEN");
        if (await scored(partner.id)) throw new ScheduleError("SWAP_TEAM_SCORED");
        station = data.station;
      } else {
        station = await claimStation(tx, target, team.id, data.station);
      }
      if (target.id === team.waveId && station === team.station) throw new ScheduleError("SAME_SLOT");

      const warnings = await slotWarnings(tx, team.category, target);
      requireConfirmations(warnings, { exception: data.confirmException, awards: data.confirmAwards });
      // The partner changes wave only when the two were in different waves.
      const partnerWarnings = partner && partner.waveId !== team.waveId ? await slotWarnings(tx, partner.category, team.waveRef!) : NO_WARNINGS;
      if (partner) requireConfirmations(partnerWarnings, { exception: data.confirmSwapException, awards: data.confirmSwapAwards }, true);

      // Guarded on where each team stood when this was read. The partner
      // steps off its station first: a station holds one team at a time.
      const now = new Date();
      if (partner) {
        const off = await tx.team.updateMany({ where: { id: partner.id, waveId: target.id, station, ...IN_FIELD }, data: { station: null } });
        if (off.count !== 1) throw new ScheduleError("SCHEDULE_CHANGED");
      }
      const done = await tx.team.updateMany({
        where: { id: team.id, waveId: team.waveId, station: team.station, ...IN_FIELD },
        data: { waveId: target.id, wave: target.number, station, slotManualAt: now },
      });
      if (done.count !== 1) throw new ScheduleError("SCHEDULE_CHANGED");
      if (partner) {
        await tx.team.update({ where: { id: partner.id }, data: { waveId: team.waveId, wave: team.waveRef!.number, station: team.station, slotManualAt: now } });
      }
      // Warm-up readiness was for the wave a team stood in: a team moved to
      // another wave warms up for it again. Waiver and entrance are its own.
      if (target.id !== team.waveId) {
        await clearReadiness(tx, team, actor.id, `moved to wave ${target.number}`);
        if (partner) await clearReadiness(tx, partner, actor.id, `moved to wave ${team.waveRef!.number}`);
      }

      const competition = `competition "${team.series.name}"`;
      const result: Moved[] = [{
        teamId: team.id,
        label: `${team.number} ${team.name}`,
        detail: `${competition} · ${slotLabel(team.waveRef, team.station)} → ${slotLabel(target, station)} · ${[
          ...notesFor(team, warnings), ...(partner ? [`exchanged with #${partner.number} ${partner.name}`] : []),
        ].join(" · ")}`,
      }];
      if (partner) {
        result.push({
          teamId: partner.id,
          label: `${partner.number} ${partner.name}`,
          detail: `${competition} · ${slotLabel(target, station)} → ${slotLabel(team.waveRef, team.station)} · ${[
            ...notesFor(partner, partnerWarnings), `exchanged with #${team.number} ${team.name}, who was moved by hand`,
          ].join(" · ")}`,
        });
      }
      return result;
    });
  } catch (error) {
    if (error instanceof SlotConfirmationError) return { ok: false, error: error.code, warnings: error.warnings };
    return scheduleError(error);
  }
  for (const one of moved) {
    await recordAudit({ actorId: actor.id, action: AUDIT.teamSlotMoved, targetType: "team", targetId: one.teamId, targetLabel: one.label, detail: one.detail });
  }
  revalidateCompetitionViews();
  return { ok: true };
}

const releaseSchema = z.object({
  teamId: z.string().min(1).max(191),
  /** The person confirmed the team may move on the next Auto Assign run. */
  confirmed: z.literal(true),
});

export async function returnToAutoAssign(input: unknown): Promise<SlotActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "UNAUTHENTICATED" };
  if (actor.viewAs || !canPlaceTeams(actor)) return { ok: false, error: "FORBIDDEN" };
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const where = { id: parsed.data.teamId, archivedAt: null, ...teamScope(actor) };
  const found = await prisma.team.findFirst({ where, select: { seriesId: true } });
  if (!found) return { ok: false, error: "NOT_FOUND" };
  let audit: { label: string; detail: string } | null;
  try {
    audit = await scheduleTransaction(found.seriesId, async (tx) => {
      const team = await tx.team.findFirst({ where, include: { waveRef: true, series: { select: { name: true } } } });
      if (!team) throw new ScheduleError("NOT_FOUND");
      // Already automatic: nothing to do, and nothing to record.
      if (!team.slotManualAt) return null;
      await tx.team.update({ where: { id: team.id }, data: { slotManualAt: null } });
      return {
        label: `${team.number} ${team.name}`,
        detail: `competition "${team.series.name}" · returned to Auto Assign · stays at ${slotLabel(team.waveRef, team.station)} until the next Auto Assign run`,
      };
    });
  } catch (error) {
    return scheduleError(error);
  }
  if (audit) {
    await recordAudit({ actorId: actor.id, action: AUDIT.teamSlotReleased, targetType: "team", targetId: parsed.data.teamId, targetLabel: audit.label, detail: audit.detail });
    revalidateCompetitionViews();
  }
  return { ok: true };
}
