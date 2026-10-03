import type { AttendanceKind } from "@/generated/prisma/enums";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { canCheckInEntrance, canMarkWarmupReady, teamScope, type CurrentUser } from "@/lib/access";
import { entranceGaps, warmupGaps, type TeamCheck, type TeamGaps } from "@/lib/readiness";
import { seatsOf, waiverStates } from "@/lib/waivers/waiver-db";
import { isEventReadinessOverridden } from "@/lib/event-readiness-override";

// ─────────────────────────────────────────────────────────────────────────────
// WRITING THE TWO CHECK-INS, AND THE TWO CHECK-OUTS.
//
//   ENTRANCE  `Competitor.attendedAt` — each person at the venue now — and
//             `Team.attendedAt`, set exactly while EVERY seat is here.
//             Check-in needs a registration holding a place and each athlete's
//             own signature of the competition's waiver (readiness.ts); a
//             team check-in names who is missing it and checks nobody in.
//             Check-out records the departure — without asking for a waiver —
//             and takes back the team's warm-up readiness.
//   WARM-UP   `Team.warmupReadyAt` + `warmupWaveId`: ready to compete, for
//             THAT wave. Check-in needs a wave and every athlete signed and at
//             the venue. Check-out clears it, whatever else has changed.
//
// Every change is also a row of AttendanceEvent — the history, only ever
// added to. EVERY WRITE IS SAFE TO REPEAT: doing what is already done changes
// nothing, writes no row, and tells the caller `changed: false` so it writes
// no second audit line either. All of it under a lock on the team row, which
// Start Wave takes too, so a check-out cannot slip past a wave starting.
//
// WHO is decided here as well as by the caller — the key (access.ts) and the
// scope (teamScope: a gym reaches only its own teams).
// ─────────────────────────────────────────────────────────────────────────────

export type CheckInActor = Pick<CurrentUser, "id" | "role" | "studioId" | "permissions">;

export type CheckInError = "FORBIDDEN" | "NOT_FOUND" | "SERIES_FINISHED" | "PREREQUISITES";

export type CheckInOutcome =
  | { ok: true; changed: boolean; team: { id: string; label: string }; detail: string }
  | { ok: false; error: CheckInError; gaps?: TeamGaps };

class Refused extends Error {
  constructor(readonly code: CheckInError, readonly gaps?: TeamGaps) {
    super(code);
  }
}

async function guarded(work: () => Promise<CheckInOutcome>): Promise<CheckInOutcome> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.code, ...(error.gaps ? { gaps: error.gaps } : {}) };
    throw error;
  }
}

const lockTeam = (tx: Prisma.TransactionClient, teamId: string) => tx.$queryRaw`SELECT id FROM Team WHERE id = ${teamId} FOR UPDATE`;

type Event = { kind: AttendanceKind; competitorId?: string | null; waveId?: string | null; reason?: string };

async function record(tx: Prisma.TransactionClient, team: { id: string; seriesId: string }, actorId: string | null, events: Event[]) {
  if (!events.length) return;
  await tx.attendanceEvent.createMany({
    data: events.map((event) => ({ seriesId: team.seriesId, teamId: team.id, actorId, kind: event.kind, competitorId: event.competitorId ?? null, waveId: event.waveId ?? null, reason: event.reason ?? null })),
  });
}

/** The team as readiness.ts reads it: each seat's waiver state and arrival. */
export async function teamCheck(tx: Prisma.TransactionClient, team: { id: string; seriesId: string; number: number; name: string; archivedAt: Date | null; waitlistedAt: Date | null; waveId: string | null; warmupReadyAt: Date | null; warmupWaveId: string | null }): Promise<TeamCheck> {
  const seats = await seatsOf(tx, [team.id]);
  const states = await waiverStates(tx, team.seriesId, seats);
  return {
    id: team.id, number: team.number, name: team.name,
    inField: !team.archivedAt && !team.waitlistedAt,
    waveId: team.waveId,
    readyForWaveId: team.warmupReadyAt ? team.warmupWaveId : null,
    athletes: seats.map((seat) => ({ id: seat.competitorId, name: seat.fullName, waiver: states.get(seat.competitorId)!, arrived: Boolean(seat.attendedAt) })),
  };
}

const TEAM_SELECT = { id: true, seriesId: true, number: true, name: true, archivedAt: true, waitlistedAt: true, waveId: true, attendedAt: true, warmupReadyAt: true, warmupWaveId: true, series: { select: { status: true, archivedAt: true } } } as const;

/**
 * Bring `Team.attendedAt` back in step with its seats: set while every seat
 * is here (stamped with the moment the last one arrived), null otherwise.
 * Called after one athlete's check-in or check-out, and after any change of
 * who is on the team (membership-sync.ts) — a newcomer has not arrived just
 * because the person they replaced had.
 */
export async function syncTeamArrival(tx: Prisma.TransactionClient, teamId: string): Promise<void> {
  const team = await tx.team.findUnique({
    where: { id: teamId },
    select: { attendedAt: true, competitors: { select: { attendedAt: true } } },
  });
  if (!team) return;
  const arrivals = team.competitors.map((seat) => seat.attendedAt);
  const everyone = arrivals.length > 0 && arrivals.every(Boolean);
  if (everyone && !team.attendedAt) {
    const last = new Date(Math.max(...arrivals.map((at) => at!.getTime())));
    await tx.team.update({ where: { id: teamId }, data: { attendedAt: last } });
  } else if (!everyone && team.attendedAt) {
    await tx.team.update({ where: { id: teamId }, data: { attendedAt: null } });
  }
}

/**
 * Take back a team's warm-up readiness — after a check-out, a move to
 * another wave, a change of who is on it. History records why. Returns
 * whether there was any to take back.
 */
export async function clearReadiness(tx: Prisma.TransactionClient, team: { id: string; seriesId: string }, actorId: string | null, reason: string): Promise<boolean> {
  const current = await tx.team.findUnique({ where: { id: team.id }, select: { warmupReadyAt: true, warmupWaveId: true } });
  if (!current?.warmupReadyAt) return false;
  await tx.team.update({ where: { id: team.id }, data: { warmupReadyAt: null, warmupWaveId: null } });
  await record(tx, team, actorId, [{ kind: "warmup_out", waveId: current.warmupWaveId, reason }]);
  return true;
}

async function lockedTeam(tx: Prisma.TransactionClient, actor: CheckInActor, teamId: string) {
  await lockTeam(tx, teamId);
  const team = await tx.team.findFirst({ where: { id: teamId, archivedAt: null, ...teamScope(actor) }, select: TEAM_SELECT });
  if (!team || team.series.archivedAt) throw new Refused("NOT_FOUND");
  return team;
}

/** The whole team is at the venue — every athlete signed first — or the whole team has left. */
export function setTeamArrival(
  db: PrismaClient,
  actor: CheckInActor,
  input: { teamId: string; attended: boolean },
  now = new Date()
): Promise<CheckInOutcome> {
  if (!canCheckInEntrance(actor)) return Promise.resolve({ ok: false, error: "FORBIDDEN" });
  return guarded(() =>
    db.$transaction(async (tx): Promise<CheckInOutcome> => {
      const team = await lockedTeam(tx, actor, input.teamId);
      const label = { id: team.id, label: `${team.number} ${team.name}` };
      const seats = await tx.competitor.findMany({ where: { teamId: team.id }, select: { id: true, attendedAt: true } });
      const here = seats.filter((seat) => seat.attendedAt);

      if (input.attended) {
        // The first check-in time stands, for each person and for the team.
        if (here.length === seats.length && (team.attendedAt || !seats.length)) return { ok: true, changed: false, team: label, detail: "" };
        const check = await teamCheck(tx, team);
        const overridden = isEventReadinessOverridden({ id: team.seriesId });
        const missing = overridden ? [] : entranceGaps(check.athletes);
        if (!check.inField || missing.length) {
          throw new Refused("PREREQUISITES", { team: { id: team.id, number: team.number, name: team.name }, gaps: check.inField ? [] : ["registration"], athletes: missing });
        }
        const arriving = seats.filter((seat) => !seat.attendedAt);
        await tx.competitor.updateMany({ where: { teamId: team.id, attendedAt: null }, data: { attendedAt: now } });
        if (!team.attendedAt) await tx.team.update({ where: { id: team.id }, data: { attendedAt: now } });
        await record(tx, team, actor.id, arriving.map((seat) => ({ kind: "entrance_in", competitorId: seat.id, ...(overridden ? { reason: "event-day readiness override" } : {}) })));
        return { ok: true, changed: true, team: label, detail: `checked in (${seats.length} of ${seats.length} athletes)${overridden ? "; event-day readiness override" : ""}` };
      }
      if (!here.length && !team.attendedAt) return { ok: true, changed: false, team: label, detail: "" };
      await tx.competitor.updateMany({ where: { teamId: team.id, NOT: { attendedAt: null } }, data: { attendedAt: null } });
      if (team.attendedAt) await tx.team.update({ where: { id: team.id }, data: { attendedAt: null } });
      await record(tx, team, actor.id, here.map((seat) => ({ kind: "entrance_out", competitorId: seat.id })));
      const cleared = await clearReadiness(tx, team, actor.id, "entrance check-out");
      return { ok: true, changed: true, team: label, detail: `checked out (${here.length} athletes)${cleared ? "; warm-up readiness cleared" : ""}` };
    })
  );
}

/** One person arrived — their own signature first — or left. */
export async function setAthleteArrival(
  db: PrismaClient,
  actor: CheckInActor,
  input: { competitorId: string; attended: boolean },
  now = new Date()
): Promise<CheckInOutcome> {
  if (!canCheckInEntrance(actor)) return { ok: false, error: "FORBIDDEN" };
  const where = { id: input.competitorId, team: { archivedAt: null, ...teamScope(actor) } };
  const located = await db.competitor.findFirst({ where, select: { teamId: true } });
  if (!located) return { ok: false, error: "NOT_FOUND" };
  return guarded(() =>
    db.$transaction(async (tx): Promise<CheckInOutcome> => {
      const team = await lockedTeam(tx, actor, located.teamId);
      const seat = await tx.competitor.findFirst({ where, select: { id: true, fullName: true, attendedAt: true } });
      if (!seat) throw new Refused("NOT_FOUND");
      const label = { id: team.id, label: `${team.number} ${team.name}` };
      if (Boolean(seat.attendedAt) === input.attended) return { ok: true, changed: false, team: label, detail: "" };

      if (input.attended) {
        const check = await teamCheck(tx, team);
        const missing = isEventReadinessOverridden({ id: team.seriesId }) ? [] : entranceGaps(check.athletes.filter((one) => one.id === seat.id));
        if (!check.inField || missing.length) {
          throw new Refused("PREREQUISITES", { team: { id: team.id, number: team.number, name: team.name }, gaps: check.inField ? [] : ["registration"], athletes: missing });
        }
      }
      await tx.competitor.update({ where: { id: seat.id }, data: { attendedAt: input.attended ? now : null } });
      await syncTeamArrival(tx, team.id);
      const overridden = input.attended && isEventReadinessOverridden({ id: team.seriesId });
      await record(tx, team, actor.id, [{ kind: input.attended ? "entrance_in" : "entrance_out", competitorId: seat.id, ...(overridden ? { reason: "event-day readiness override" } : {}) }]);
      if (input.attended) return { ok: true, changed: true, team: label, detail: `${seat.fullName} checked in${overridden ? "; event-day readiness override" : ""}` };
      const cleared = await clearReadiness(tx, team, actor.id, `${seat.fullName} checked out`);
      return { ok: true, changed: true, team: label, detail: `${seat.fullName} checked out${cleared ? "; warm-up readiness cleared" : ""}` };
    })
  );
}

/** Ready to compete in this wave — every athlete signed and at the venue — or not any more. */
export function setWarmupReady(
  db: PrismaClient,
  actor: CheckInActor,
  input: { teamId: string; ready: boolean },
  now = new Date()
): Promise<CheckInOutcome> {
  if (!canMarkWarmupReady(actor)) return Promise.resolve({ ok: false, error: "FORBIDDEN" });
  return guarded(() =>
    db.$transaction(async (tx): Promise<CheckInOutcome> => {
      const team = await lockedTeam(tx, actor, input.teamId);
      // Nothing changes the floor of a finished competition.
      if (team.series.status === "final") throw new Refused("SERIES_FINISHED");
      const label = { id: team.id, label: `${team.number} ${team.name}` };

      if (!input.ready) {
        // Always allowed — even when the waiver has since gone out of date.
        const cleared = await clearReadiness(tx, team, actor.id, "warm-up check-out");
        return cleared ? { ok: true, changed: true, team: label, detail: "warm-up check-out: readiness cleared" } : { ok: true, changed: false, team: label, detail: "" };
      }
      const check = await teamCheck(tx, team);
      const gaps = warmupGaps(check);
      const overridden = isEventReadinessOverridden({ id: team.seriesId });
      if (overridden) gaps.athletes = [];
      if (gaps.gaps.length || gaps.athletes.length) throw new Refused("PREREQUISITES", gaps);
      if (team.warmupReadyAt && team.warmupWaveId === team.waveId) return { ok: true, changed: false, team: label, detail: "" };
      await tx.team.update({ where: { id: team.id }, data: { warmupReadyAt: now, warmupWaveId: team.waveId } });
      await record(tx, team, actor.id, [{ kind: "warmup_in", waveId: team.waveId, ...(overridden ? { reason: "event-day readiness override" } : {}) }]);
      const wave = team.waveId ? await tx.wave.findUnique({ where: { id: team.waveId }, select: { number: true } }) : null;
      return { ok: true, changed: true, team: label, detail: `ready to compete in wave ${wave?.number ?? "?"} (warm-up check-in)${overridden ? "; event-day readiness override" : ""}` };
    })
  );
}
