"use server";

import { z } from "zod";
import { can, isBft } from "@/lib/access";
import { AUDIT, recordAudit } from "@/lib/audit";
import { lowestFreeStation } from "@/lib/floor";
import { prisma } from "@/lib/prisma";
import { requireAccess, requireRole } from "@/lib/session";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { ScheduleError, scheduleError } from "@/lib/wave-schedule";
import { scheduleTransaction } from "@/lib/wave-schedule-db";

const submitSchema = z.object({
  teamId: z.string().min(1), preference: z.enum(["morning", "midday", "evening"]),
  note: z.string().trim().max(1000).default(""),
});

export async function requestWaveChange(input: unknown) {
  const actor = await requireRole("competitor");
  if (actor.viewAs || !can(actor, "athleteHome.view")) return { ok: false as const, error: "FORBIDDEN" };
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "INVALID_INPUT" };
  const { teamId, preference, note } = parsed.data;
  const team = await prisma.team.findFirst({ where: { id: teamId, archivedAt: null, competitors: { some: { userId: actor.id } } }, select: { seriesId: true } });
  if (!team) return { ok: false as const, error: "NOT_FOUND" };
  try {
    await scheduleTransaction(team.seriesId, async tx => {
      const current = await tx.team.findFirst({
        where: { id: teamId, archivedAt: null, competitors: { some: { userId: actor.id } } },
        include: { waveRef: true, series: true },
      });
      const account = await tx.user.findUnique({ where: { id: actor.id }, select: { approvalStatus: true } });
      if (!account || account.approvalStatus !== "approved") throw new ScheduleError("FORBIDDEN");
      if (!current || current.waitlistedAt || !current.waveRef || current.waveRef.status !== "pending" ||
          current.series.archivedAt || current.series.status === "final") throw new ScheduleError("NOT_ELIGIBLE");
      if (await tx.waveChangeRequest.findUnique({ where: { openTeamId: teamId } })) throw new ScheduleError("REQUEST_PENDING");
      await tx.waveChangeRequest.create({ data: {
        teamId, seriesId: current.seriesId, requestedById: actor.id, preference, note: note || null,
        openTeamId: teamId, fromWaveNumber: current.waveRef.number, fromStartTime: current.waveRef.startTime,
      } });
    });
  } catch (error) { return scheduleError(error); }
  await recordAudit({ actorId: actor.id, action: AUDIT.waveChangeRequested, targetType: "team", targetId: teamId, detail: preference });
  revalidateCompetitionViews();
  return { ok: true as const };
}

const approveSchema = z.object({
  requestId: z.string().min(1), targetWaveId: z.string().min(1),
  teamVersion: z.string().datetime(), sourceWaveId: z.string().min(1), sourceWaveVersion: z.string().datetime(),
  targetWaveVersion: z.string().datetime(), targetOccupied: z.number().int().min(0),
});

export async function approveWaveChange(input: unknown) {
  const actor = await requireAccess("approvals.decide");
  if (!isBft(actor) || actor.viewAs || !can(actor, "approvals.view") || !can(actor, "waves.placeTeams")) return { ok: false as const, error: "FORBIDDEN" };
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "INVALID_INPUT" };
  const data = parsed.data;
  const found = await prisma.waveChangeRequest.findUnique({ where: { id: data.requestId }, select: { seriesId: true, teamId: true } });
  if (!found) return { ok: false as const, error: "NOT_FOUND" };
  try {
    await scheduleTransaction(found.seriesId, async tx => {
      const request = await tx.waveChangeRequest.findUnique({ where: { id: data.requestId }, include: { team: { include: { waveRef: true } }, series: true } });
      if (!request || request.status !== "pending") throw new ScheduleError("SCHEDULE_CHANGED");
      const team = request.team;
      if (request.series.archivedAt || request.series.status === "final" || team.archivedAt || team.waitlistedAt || team.waveRef?.status !== "pending") throw new ScheduleError("NOT_ELIGIBLE");
      if (team.updatedAt.toISOString() !== data.teamVersion || team.waveId !== data.sourceWaveId ||
          team.waveRef.updatedAt.toISOString() !== data.sourceWaveVersion) throw new ScheduleError("SCHEDULE_CHANGED");
      const target = await tx.wave.findFirst({ where: { id: data.targetWaveId, seriesId: request.seriesId }, include: { teams: { select: { station: true } } } });
      if (!target || target.id === team.waveId) throw new ScheduleError("INVALID_INPUT");
      if (target.status !== "pending") throw new ScheduleError("WAVE_STARTED");
      if (target.updatedAt.toISOString() !== data.targetWaveVersion || target.teams.length !== data.targetOccupied) throw new ScheduleError("SCHEDULE_CHANGED");
      if (target.teams.length >= target.capacity) throw new ScheduleError("WAVE_FULL");
      const station = lowestFreeStation(target.teams.map(row => row.station), target.capacity);
      if (station === null) throw new ScheduleError("WAVE_FULL");
      // A guarded update also detects a competing legacy writer after our read.
      const moved = await tx.team.updateMany({
        where: { id: team.id, updatedAt: team.updatedAt, waveId: team.waveId, archivedAt: null, waitlistedAt: null },
        data: { waveId: target.id, wave: target.number, station },
      });
      if (moved.count !== 1) throw new ScheduleError("SCHEDULE_CHANGED");
      const decided = await tx.waveChangeRequest.updateMany({ where: { id: request.id, status: "pending" }, data: {
        status: "approved", openTeamId: null, reviewedById: actor.id, reviewedAt: new Date(),
        fromWaveNumber: team.waveRef.number, fromStartTime: team.waveRef.startTime,
        toWaveNumber: target.number, toStartTime: target.startTime,
      } });
      if (decided.count !== 1) throw new ScheduleError("SCHEDULE_CHANGED");
    });
  } catch (error) { return scheduleError(error); }
  await recordAudit({ actorId: actor.id, action: AUDIT.waveChangeApproved, targetType: "team", targetId: found.teamId,
    detail: `request=${data.requestId} from=${data.sourceWaveId} to=${data.targetWaveId}` });
  revalidateCompetitionViews();
  return { ok: true as const };
}

export async function rejectWaveChange(input: unknown) {
  const actor = await requireAccess("approvals.decide");
  if (!isBft(actor) || actor.viewAs || !can(actor, "approvals.view") || !can(actor, "waves.placeTeams")) return { ok: false as const, error: "FORBIDDEN" };
  const parsed = z.object({ requestId: z.string().min(1), reason: z.string().trim().min(1).max(1000) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "INVALID_INPUT" };
  const request = await prisma.waveChangeRequest.findUnique({ where: { id: parsed.data.requestId }, select: { seriesId: true, teamId: true } });
  if (!request) return { ok: false as const, error: "NOT_FOUND" };
  try {
    await scheduleTransaction(request.seriesId, async tx => {
      const result = await tx.waveChangeRequest.updateMany({ where: { id: parsed.data.requestId, status: "pending" }, data: {
        status: "rejected", openTeamId: null, reviewedById: actor.id, reviewedAt: new Date(), rejectionReason: parsed.data.reason,
      } });
      if (result.count !== 1) throw new ScheduleError("SCHEDULE_CHANGED");
    });
  } catch (error) { return scheduleError(error); }
  await recordAudit({ actorId: actor.id, action: AUDIT.waveChangeRejected, targetType: "team", targetId: request.teamId,
    detail: `request=${parsed.data.requestId}; ${parsed.data.reason}` });
  revalidateCompetitionViews();
  return { ok: true as const };
}
