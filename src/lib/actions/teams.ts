"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { lowestFreeStation, MAX_STATIONS } from "@/lib/floor";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { assignmentPlan, ScheduleError, scheduleError } from "@/lib/wave-schedule";
import { scheduleTransaction, waveRowFor } from "@/lib/wave-schedule-db";
import { can, requireAccess, teamScope } from "@/lib/session";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { message?: string } : { message?: string; data: T }))
  | { ok: false; error: string };

const setWaveSchema = z.object({
  teamId: z.string().min(1),
  wave: z.coerce.number().int().min(1).max(99),
});

/**
 * Put a team into a wave. It takes the lowest free station there (1–9), which
 * it then keeps in every zone; a full wave refuses with WAVE_FULL.
 */
export async function setTeamWave(input: unknown): Promise<ActionResult> {
  const user = await requireAccess("waves.placeTeams");
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = setWaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const found = await prisma.team.findFirst({
    where: { id: parsed.data.teamId, archivedAt: null, ...teamScope(user) },
    select: { seriesId: true },
  });
  if (!found) return { ok: false, error: "NOT_FOUND" };
  try {
    await scheduleTransaction(found.seriesId, async (tx) => {
      const team = await tx.team.findFirst({
        where: { id: parsed.data.teamId, archivedAt: null, ...teamScope(user) },
        include: { waveRef: true, series: true },
      });
      if (!team || team.series.archivedAt) throw new ScheduleError("NOT_FOUND");
      if (team.waitlistedAt) throw new ScheduleError("ON_THE_WAITING_LIST");
      if (team.series.status === "final" || (team.waveRef && team.waveRef.status !== "pending")) throw new ScheduleError("WAVE_STARTED");
      // Moving into a wave number nobody has made would make it: that is
      // building the running order (waves.edit), not placing a team in it.
      if (!can(user, "waves.edit")) {
        const exists = await tx.wave.count({ where: { seriesId: team.seriesId, number: parsed.data.wave } });
        if (!exists) throw new ScheduleError("NO_SUCH_WAVE");
      }
      const target = await waveRowFor(tx, team.seriesId, parsed.data.wave);
      if (target.status !== "pending") throw new ScheduleError("WAVE_STARTED");
      if (target.id === team.waveId) return;
      const occupants = await tx.team.findMany({ where: { waveId: target.id }, select: { station: true } });
      if (occupants.length >= target.capacity) throw new ScheduleError("WAVE_FULL");
      const station = lowestFreeStation(occupants.map(row => row.station), target.capacity);
      if (station === null) throw new ScheduleError("WAVE_FULL");
      await tx.team.update({ where: { id: team.id }, data: { wave: target.number, waveId: target.id, station } });
    });
  } catch (error) { return scheduleError(error); }
  revalidateCompetitionViews();
  return { ok: true };
}

const stationSchema = z.object({
  teamId: z.string().min(1),
  station: z.coerce.number().int().min(1).max(MAX_STATIONS),
});

/**
 * Move a team to another station in its wave, before the wave starts. If a
 * team already stands there the two swap — provided the mover may move that
 * team too (a studio cannot shift another studio's team).
 */
export async function setTeamStation(input: unknown): Promise<ActionResult> {
  const user = await requireAccess("waves.placeTeams");
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = stationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const found = await prisma.team.findFirst({ where: { id: parsed.data.teamId, archivedAt: null, ...teamScope(user) }, select: { seriesId: true } });
  if (!found) return { ok: false, error: "NOT_FOUND" };
  try {
    await scheduleTransaction(found.seriesId, async tx => {
      const team = await tx.team.findFirst({ where: { id: parsed.data.teamId, archivedAt: null, ...teamScope(user) }, include: { waveRef: true } });
      if (!team?.waveId || !team.waveRef) throw new ScheduleError("NOT_FOUND");
      if (team.waitlistedAt || team.waveRef.status !== "pending") throw new ScheduleError("WAVE_STARTED");
      if (parsed.data.station > team.waveRef.capacity) throw new ScheduleError("BEYOND_CAPACITY");
      if (team.station === parsed.data.station) return;
      const occupant = await tx.team.findFirst({ where: { waveId: team.waveId, station: parsed.data.station }, select: { id: true } });
      if (occupant && !await tx.team.count({ where: { id: occupant.id, ...teamScope(user) } })) throw new ScheduleError("STATION_TAKEN");
      if (occupant) await tx.team.update({ where: { id: occupant.id }, data: { station: null } });
      await tx.team.update({ where: { id: team.id }, data: { station: parsed.data.station } });
      if (occupant) await tx.team.update({ where: { id: occupant.id }, data: { station: team.station } });
    });
  } catch (error) { return scheduleError(error); }
  revalidateCompetitionViews();
  return { ok: true };
}

const autoAssignSchema = z.object({
  seriesId: z.string().min(1),
  // One team per station: never more than nine.
  perWave: z.coerce.number().int().min(1).max(MAX_STATIONS),
});

/** Rebuild the whole pre-event field in category, level, then team-number order. */
export async function autoAssignWaves(input: unknown): Promise<ActionResult> {
  const user = await requireAccess("waves.edit");
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = autoAssignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId, perWave } = parsed.data;
  let assigned;
  try {
    assigned = await scheduleTransaction(seriesId, async (tx) => {
      const series = await tx.series.findUnique({ where: { id: seriesId } });
      if (!series || series.archivedAt) throw new ScheduleError("NOT_FOUND");
      if (series.status !== "scheduled" || await tx.wave.count({ where: { seriesId, status: { not: "pending" } } })) {
        throw new ScheduleError("WAVE_STARTED");
      }
      const teams = await tx.team.findMany({
        where: { seriesId, archivedAt: null, waitlistedAt: null },
        select: { id: true, category: true, division: true, number: true },
      });
      const plan = assignmentPlan(teams, perWave);
      const waveCount = Math.ceil(plan.length / perWave);
      await tx.series.update({ where: { id: seriesId }, data: { waveCapacity: perWave } });
      // Free stations first, including excluded rows which must hold no place.
      await tx.team.updateMany({ where: { seriesId }, data: { station: null, waveId: null } });
      await tx.wave.deleteMany({ where: { seriesId, number: { gt: waveCount } } });
      await tx.wave.updateMany({ where: { seriesId }, data: { capacity: perWave, durationMinutes: series.waveMinutes } });
      const waveIds = new Map<number, string>();
      for (let number = 1; number <= waveCount; number++) {
        const wave = await waveRowFor(tx, seriesId, number);
        waveIds.set(number, wave.id);
      }
      for (const placement of plan) {
        await tx.team.update({ where: { id: placement.team.id }, data: {
          wave: placement.number, waveId: waveIds.get(placement.number)!, station: placement.station,
        } });
      }
      return { teams: plan.length, waves: waveCount };
    });
  } catch (error) { return scheduleError(error); }
  await recordAudit({ actorId: user.id, action: AUDIT.wavesAssigned, targetType: "event", targetId: seriesId,
    detail: String(assigned.teams) + " teams; " + String(assigned.waves) + " waves; capacity=" + String(perWave) });
  revalidateCompetitionViews();
  return { ok: true };
}
