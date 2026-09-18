import "server-only";
import { cache } from "react";

import { prisma } from "@/lib/prisma";
import { accountScope, type CurrentUser } from "@/lib/session";
import { waveClockSweep, type WaveState } from "@/lib/waves";

// Studios, accounts, the score audit, the prescribed loads and the wave rows:
// the reads that are not about a team's result.

// ── Studios and accounts ─────────────────────────────────────────────────────

export async function listStudios() {
  return prisma.studio.findMany({ orderBy: { name: "asc" } });
}

export async function listAccounts(user: CurrentUser) {
  // Archived accounts ("removed from the platform") live in their own filter,
  // served by listArchivedAccounts — the working list is exactly that.
  return prisma.user.findMany({
    where: { ...accountScope(user), archivedAt: null },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      accessRoleId: true,
      archivedAt: true,
      lastLoginAt: true,
      createdAt: true,
      studio: { select: { id: true, name: true } },
    },
  });
}

/** Removed accounts, kept answerable — audits and invitations stay linked. */
export async function listArchivedAccounts(user: CurrentUser) {
  return prisma.user.findMany({
    where: { ...accountScope(user), NOT: { archivedAt: null } },
    orderBy: [{ archivedAt: "desc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      accessRoleId: true,
      archivedAt: true,
      lastLoginAt: true,
      createdAt: true,
      studio: { select: { id: true, name: true } },
    },
  });
}

/**
 * Every score change in a competition, grouped by team.
 *
 * One query rather than one per team: the score sheet shows a hundred rows and
 * any of them may be opened, so fetching a team's history when it is clicked
 * would mean a hundred possible round trips during the busiest hour of the day.
 */
export async function getSeriesScoreAudit(seriesId: string, perTeam = 8, teamId?: string) {
  const rows = await prisma.scoreAudit.findMany({
    where: { score: { team: { seriesId, ...(teamId ? { id: teamId } : {}) } } },
    ...(teamId ? { take: perTeam } : {}),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      field: true,
      oldValue: true,
      newValue: true,
      createdAt: true,
      operator: { select: { name: true, email: true } },
      score: { select: { teamId: true } },
    },
  });

  const byTeam = new Map<string, ScoreAuditLine[]>();
  for (const row of rows) {
    const list = byTeam.get(row.score.teamId) ?? [];
    if (list.length >= perTeam) continue;
    list.push({
      id: row.id,
      field: row.field,
      oldValue: row.oldValue,
      newValue: row.newValue,
      at: row.createdAt.toISOString().slice(0, 16).replace("T", " "),
      operator: row.operator?.name ?? row.operator?.email ?? "—",
    });
    byTeam.set(row.score.teamId, list);
  }

  return byTeam;
}

/** One line of a team's score history, ready to render. */
export type ScoreAuditLine = {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  at: string;
  operator: string;
};

export async function getLoadStandards() {
  return prisma.loadStandard.findMany();
}

// ── Waves ────────────────────────────────────────────────────────────────────

/**
 * Every wave of an event, with how many teams sit in it and how many of those
 * are scored. The remaining time is sent as a duration, not an instant, so a
 * screen anchors it against its own clock.
 *
 * Before reading, the wave clock is SWEPT: a running wave whose time has run
 * out is finished and the next wave with teams steps on — automatically, with
 * no operator present, so a wave can never hang on the floor after its clock
 * has died. Chained by order, not by wall-clock time; only a LIVE event sweeps
 * (a scheduled one must not run itself, a finished one must not change).
 */
export const getSeriesWaves = cache(async (seriesId: string): Promise<WaveState[]> => {
  // The clock sweep and displayed counts use the same snapshot. Previously a
  // normal tab read fetched the owner, schedule and schedule-with-teams in
  // sequence even when no clock had expired.
  const load = () => prisma.wave.findMany({
    where: { seriesId },
    orderBy: { number: "asc" },
    include: {
      series: { select: { status: true } },
      teams: { select: { score: { select: { status: true } } } },
    },
  });
  let waves = await load();

  if (waves[0]?.series.status === "live") {

    const sweep = waveClockSweep(
      waves.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        endsAt: row.endsAt,
        durationMinutes: row.durationMinutes,
        teamCount: row.teams.length,
      })),
      new Date()
    );

    if (sweep.finish.length > 0 || sweep.start) {
      await prisma.$transaction([
        ...sweep.finish.map((id) =>
          prisma.wave.update({ where: { id }, data: { status: "complete" } })
        ),
        ...(sweep.start
          ? [
              prisma.wave.update({
                where: { id: sweep.start.id },
                data: {
                  status: "running",
                  startedAt: sweep.start.startedAt,
                  endsAt: sweep.start.endsAt,
                },
              }),
            ]
          : []),
      ]);
      // Read the committed rows after the sweep, including concurrent score
      // changes, before presenting a completed/running wave to the caller.
      waves = await load();
    }
  }

  const now = Date.now();

  return waves.map((wave) => ({
    id: wave.id,
    number: wave.number,
    status: wave.status,
    capacity: wave.capacity,
    durationMinutes: wave.durationMinutes,
    startTime: wave.startTime,
    remainingMs:
      wave.status === "running" && wave.endsAt
        ? Math.max(0, wave.endsAt.getTime() - now)
        : null,
    endsAt: wave.endsAt?.toISOString() ?? null,
    stoppedRemainingMs:
      wave.status === "complete" && wave.endsAt && wave.startedAt
        ? Math.max(
            0,
            wave.durationMinutes * 60_000 - (wave.endsAt.getTime() - wave.startedAt.getTime())
          )
        : null,
    teamCount: wave.teams.length,
    scoredCount: wave.teams.filter((t) => t.score?.status === "submitted").length,
  }));
});
