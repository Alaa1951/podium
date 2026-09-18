"use server";

import { z } from "zod";

import type { Category, Division } from "@/generated/prisma/enums";
import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { CATEGORIES, DIVISIONS, normalizeName } from "@/lib/scoring";
import { canRegisterTeams, requireUser, teamScope } from "@/lib/session";
import { deletionGuard } from "@/lib/series-guard";
import { resolveOwningStudio } from "@/lib/team-scope";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { message?: string } : { message?: string; data: T }))
  | { ok: false; error: string };

export async function nextTeamNumber(seriesId: string) {
  const highest = await prisma.team.findFirst({
    where: { seriesId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return Math.max(100, highest?.number ?? 100) + 1;
}

const addTeamSchema = z.object({
  seriesId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  athlete1: z.string().trim().max(80).optional(),
  athlete2: z.string().trim().max(80).optional(),
  category: z.enum(["Rookie", "Open", "Pro"]),
  division: z.enum(["Men", "Women", "Mixed"]),
  studioId: z.string().optional(),
  athlete1StudioId: z.string().optional(),
  athlete2StudioId: z.string().optional(),
});

export async function addTeam(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  if (!canRegisterTeams(user)) return { ok: false, error: "FORBIDDEN" };

  const parsed = addTeamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "TEAM_NAME_REQUIRED" };

  const data = parsed.data;
  const owningStudio = resolveOwningStudio(user, data.studioId ?? null);
  const number = await nextTeamNumber(data.seriesId);

  const competitors = [
    { fullName: data.athlete1?.trim() || "TBC", studioId: data.athlete1StudioId || null },
    { fullName: data.athlete2?.trim() || "TBC", studioId: data.athlete2StudioId || null },
  ];

  await prisma.team.create({
    data: {
      seriesId: data.seriesId,
      number,
      name: data.name.toUpperCase(),
      category: data.category as Category,
      division: data.division as Division,
      studioId: owningStudio,
      competitors: {
        create: competitors.map((a, index) => ({
          fullName: a.fullName,
          position: index + 1,
          normalizedName: normalizeName(a.fullName),
          // A studio may only vouch for membership of its own studio.
          studioId: user.role === "studio" ? (a.studioId ? user.studioId : null) : a.studioId,
        })),
      },
    },
  });

  revalidateCompetitionViews();
  return { ok: true, message: `Added ${data.name.toUpperCase()} as team ${number}.` };
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

export async function setTeamWave(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  if (!canRegisterTeams(user)) return { ok: false, error: "FORBIDDEN" };

  const parsed = setWaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  // The scope filter is part of the lookup, so a studio cannot move another
  // studio's team by guessing its id.
  const team = await prisma.team.findFirst({
    where: { id: parsed.data.teamId, ...teamScope(user) },
    select: { id: true, seriesId: true, waveRef: { select: { status: true, number: true } } },
  });
  if (!team) return { ok: false, error: "NOT_FOUND" };

  // A team cannot be pulled out of a wave that has already run or is running:
  // the running order is the record of what happened on the floor. BFT MENA
  // can, because a mis-scheduled team is theirs to correct.
  if (user.role !== "admin" && team.waveRef && team.waveRef.status !== "pending") {
    return { ok: false, error: "WAVE_STARTED" };
  }

  const waveId = await waveRowFor(team.seriesId, parsed.data.wave);

  await prisma.team.update({
    where: { id: team.id },
    data: { wave: parsed.data.wave, waveId },
  });

  revalidateCompetitionViews();
  return { ok: true };
}

const autoAssignSchema = z.object({
  seriesId: z.string().min(1),
  perWave: z.coerce.number().int().min(1).max(40),
});

/**
 * Groups by bracket first, then fills waves in order — so a wave runs one or
 * two brackets at a time and the judges use one set of loads per floor.
 */
export async function autoAssignWaves(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  if (user.role !== "admin") return { ok: false, error: "FORBIDDEN" };

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
    where: { seriesId: parsed.data.seriesId },
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

  await prisma.$transaction(
    ordered.map((team, index) => {
      const number = Math.floor(index / perWave) + 1;
      return prisma.team.update({
        where: { id: team.id },
        data: { wave: number, waveId: waveIds.get(number) ?? null },
      });
    })
  );

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
