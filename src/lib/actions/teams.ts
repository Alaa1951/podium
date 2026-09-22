"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { lowestFreeStation, MAX_STATIONS } from "@/lib/floor";
import { nextTeamNumber as sharedNextTeamNumber } from "@/lib/team-create";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { CATEGORIES, DIVISIONS } from "@/lib/scoring";
import { can, requireAccess, teamScope } from "@/lib/session";
import { deletionGuard } from "@/lib/series-guard";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { message?: string } : { message?: string; data: T }))
  | { ok: false; error: string };

/**
 * Kept as a named export for the callers that read better with it, but the
 * arithmetic itself lives in one place now: there used to be a second, subtly
 * different copy in `registrations.ts` without the floor at 100.
 */
export async function nextTeamNumber(seriesId: string) {
  return sharedNextTeamNumber(prisma, seriesId);
}

/**
 * The Wave row for a number in an event, created from the event's own defaults
 * if the running order does not reach that far yet.
 *
 * A team's wave number and the wave it is linked to must never disagree, so
 * every path that sets one sets the other through here.
 */
async function waveRowFor(seriesId: string, number: number) {
  const found = await prisma.wave.findUnique({
    where: { seriesId_number: { seriesId, number } },
    select: { id: true },
  });
  if (found) return found.id;

  const event = await prisma.series.findUnique({
    where: { id: seriesId },
    select: { firstWaveTime: true, waveMinutes: true, waveCapacity: true },
  });
  if (!event) return null;

  // Each wave runs after the one before it, from the event's first wave time —
  // a starting point the operator can then change wave by wave.
  const [h, m] = event.firstWaveTime.split(":");
  const start =
    ((parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0) + (number - 1) * event.waveMinutes) % 1440;

  const created = await prisma.wave.create({
    data: {
      seriesId,
      number,
      startTime: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`,
      durationMinutes: event.waveMinutes,
      capacity: event.waveCapacity,
    },
    select: { id: true },
  });

  return created.id;
}

const setWaveSchema = z.object({
  teamId: z.string().min(1),
  wave: z.coerce.number().int().min(1).max(40),
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

  // The scope filter is part of the lookup, so a studio cannot move another
  // studio's team by guessing its id.
  const team = await prisma.team.findFirst({
    where: { id: parsed.data.teamId, ...teamScope(user) },
    select: { id: true, seriesId: true, waveId: true, waveRef: { select: { status: true, number: true } } },
  });
  if (!team) return { ok: false, error: "NOT_FOUND" };

  // A team cannot be pulled out of — or pushed into — a wave that has already
  // run or is running: the running order is the record of what happened on
  // the floor. Whoever edits the schedule itself (waves.edit) can, because a
  // mis-scheduled team is theirs to correct.
  if (!can(user, "waves.edit") && team.waveRef && team.waveRef.status !== "pending") {
    return { ok: false, error: "WAVE_STARTED" };
  }

  const waveId = await waveRowFor(team.seriesId, parsed.data.wave);
  if (!waveId) return { ok: false, error: "NOT_FOUND" };
  if (waveId === team.waveId) return { ok: true };

  const target = await prisma.wave.findUnique({
    where: { id: waveId },
    select: { status: true, capacity: true, teams: { where: { archivedAt: null }, select: { station: true } } },
  });
  if (!target) return { ok: false, error: "NOT_FOUND" };
  if (!can(user, "waves.edit") && target.status !== "pending") return { ok: false, error: "WAVE_STARTED" };

  const station = lowestFreeStation(target.teams.map((row) => row.station), target.capacity);
  if (station === null) return { ok: false, error: "WAVE_FULL" };

  try {
    await prisma.team.update({
      where: { id: team.id },
      data: { wave: parsed.data.wave, waveId, station },
    });
  } catch {
    // Two placements raced for the same station: the unique index kept one.
    return { ok: false, error: "WAVE_FULL" };
  }

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

  const team = await prisma.team.findFirst({
    where: { id: parsed.data.teamId, archivedAt: null, ...teamScope(user) },
    select: { id: true, waveId: true, station: true, waveRef: { select: { status: true, capacity: true } } },
  });
  if (!team?.waveId || !team.waveRef) return { ok: false, error: "NOT_FOUND" };
  if (team.waveRef.status !== "pending") return { ok: false, error: "WAVE_STARTED" };
  // A station the wave does not have is a rig that is not on the floor. Its
  // own error code, not INVALID_INPUT: the screen can then say WHY, and
  // "something went wrong" is what sends somebody to re-type the same number.
  if (parsed.data.station > team.waveRef.capacity) {
    return { ok: false, error: "BEYOND_CAPACITY" };
  }
  if (team.station === parsed.data.station) return { ok: true };

  const occupant = await prisma.team.findFirst({
    where: { waveId: team.waveId, station: parsed.data.station, archivedAt: null },
    select: { id: true },
  });
  if (occupant) {
    const mayMove = await prisma.team.count({ where: { id: occupant.id, ...teamScope(user) } });
    if (!mayMove) return { ok: false, error: "STATION_TAKEN" };
  }

  // Free the target first so the unique (wave, station) index never sees two.
  await prisma.$transaction([
    ...(occupant ? [prisma.team.update({ where: { id: occupant.id }, data: { station: null } })] : []),
    prisma.team.update({ where: { id: team.id }, data: { station: parsed.data.station } }),
    ...(occupant ? [prisma.team.update({ where: { id: occupant.id }, data: { station: team.station } })] : []),
  ]);

  revalidateCompetitionViews();
  return { ok: true };
}

const autoAssignSchema = z.object({
  seriesId: z.string().min(1),
  // One team per station: never more than nine.
  perWave: z.coerce.number().int().min(1).max(MAX_STATIONS),
});

/**
 * Groups by bracket first, then fills waves in order — so a wave runs one or
 * two brackets at a time and the judges use one set of loads per floor.
 */
export async function autoAssignWaves(input: unknown): Promise<ActionResult> {
  const user = await requireAccess("waves.edit");
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = autoAssignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  // Re-planning the running order while a wave is on the floor would move
  // teams out from under the judges. The floor has to be clear first — and
  // re-planning at all is a pre-event operation, like every other deletion.
  const onFloor = await prisma.wave.count({
    where: { seriesId: parsed.data.seriesId, status: "running" },
  });
  if (onFloor > 0) return { ok: false, error: "WAVE_RUNNING" };

  const planned = await prisma.series.findUnique({
    where: { id: parsed.data.seriesId },
    select: { status: true },
  });
  if (!planned) return { ok: false, error: "NOT_FOUND" };
  const phase = deletionGuard(planned.status);
  if (!phase.allowed) return { ok: false, error: phase.reason };

  const teams = await prisma.team.findMany({
    where: { seriesId: parsed.data.seriesId, archivedAt: null },
    select: { id: true, category: true, division: true, number: true },
  });

  const ordered = CATEGORIES.flatMap((category) =>
    DIVISIONS.flatMap((division) =>
      teams
        .filter((t) => t.category === category && t.division === division)
        .sort((a, b) => a.number - b.number)
    )
  );

  const perWave = parsed.data.perWave;
  const waveCount = Math.max(1, Math.ceil(ordered.length / perWave));

  // The running order is rows, not just numbers on teams: build the waves the
  // plan needs before linking anything to them, so the rack and the clocks
  // exist the moment the assignment lands.
  await prisma.series.update({
    where: { id: parsed.data.seriesId },
    data: { waveCapacity: perWave },
  });

  const waveIds = new Map<number, string>();
  for (let number = 1; number <= waveCount; number++) {
    const id = await waveRowFor(parsed.data.seriesId, number);
    if (id) waveIds.set(number, id);
  }

  // Waves the new plan no longer needs, and that never ran, are cleared away
  // rather than left on the rack as empty clocks.
  await prisma.wave.deleteMany({
    where: { seriesId: parsed.data.seriesId, number: { gt: waveCount }, status: "pending" },
  });

  // Stations are re-dealt from 1 in every wave. Clear them all first, so the
  // unique (wave, station) index never sees two teams on one station mid-way.
  await prisma.$transaction([
    prisma.team.updateMany({ where: { seriesId: parsed.data.seriesId }, data: { station: null } }),
    ...ordered.map((team, index) => {
      const number = Math.floor(index / perWave) + 1;
      return prisma.team.update({
        where: { id: team.id },
        data: { wave: number, waveId: waveIds.get(number) ?? null, station: (index % perWave) + 1 },
      });
    }),
  ]);

  await recordAudit({
    actorId: user.id,
    action: AUDIT.wavesAssigned,
    targetType: "event",
    targetId: parsed.data.seriesId,
    detail: `${ordered.length} teams · ${waveCount} waves of ${perWave}`,
  });

  revalidateCompetitionViews();
  return {
    ok: true,
    message: `${ordered.length} teams assigned across ${waveCount} waves of ${perWave}.`,
  };
}
