import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { canCheckInEntrance, canMarkWarmupReady, teamScope, type CurrentUser } from "@/lib/access";

// ─────────────────────────────────────────────────────────────────────────────
// WRITING THE TWO CHECK-INS.
//
//   ENTRANCE  `Competitor.attendedAt` — each person's arrival — and
//             `Team.attendedAt`, which is set exactly while EVERY seat has
//             arrived. The two are written in one transaction, under a lock
//             on the team row, so two volunteers pressing at the same moment
//             cannot leave them disagreeing.
//   WARM-UP   `Team.warmupReadyAt`. Its write never names an arrival column,
//             and an arrival write never names it.
//
// EVERY WRITE IS SAFE TO REPEAT. Checking in somebody who is checked in
// changes nothing: the first time stands, no row is written, and the caller
// is told `changed: false` so it writes no second audit line either.
//
// WHO is decided here as well as by the caller — the key (access.ts) and the
// scope (teamScope: a gym reaches only its own teams) — so a request that
// skips the screen meets the same answer.
// ─────────────────────────────────────────────────────────────────────────────

export type CheckInActor = Pick<CurrentUser, "id" | "role" | "studioId" | "permissions">;

export type CheckInError = "FORBIDDEN" | "NOT_FOUND" | "SERIES_FINISHED";

export type CheckInOutcome =
  | { ok: true; changed: boolean; team: { id: string; label: string }; detail: string }
  | { ok: false; error: CheckInError };

class Refused extends Error {
  constructor(readonly code: CheckInError) {
    super(code);
  }
}

async function guarded(work: () => Promise<CheckInOutcome>): Promise<CheckInOutcome> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.code };
    throw error;
  }
}

const lockTeam = (tx: Prisma.TransactionClient, teamId: string) => tx.$queryRaw`SELECT id FROM Team WHERE id = ${teamId} FOR UPDATE`;

/**
 * Bring `Team.attendedAt` back in step with its seats: set while every seat
 * has arrived (stamped with the moment the last one did), null otherwise.
 * Called after one athlete's check-in, and after any change of who is on the
 * team (membership-sync.ts) — a newcomer has not arrived just because the
 * person they replaced had.
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

/** The whole team arrived together — or, undone, none of them is here. */
export function setTeamArrival(
  db: PrismaClient,
  actor: CheckInActor,
  input: { teamId: string; attended: boolean },
  now = new Date()
): Promise<CheckInOutcome> {
  if (!canCheckInEntrance(actor)) return Promise.resolve({ ok: false, error: "FORBIDDEN" });
  return guarded(() =>
    db.$transaction(async (tx): Promise<CheckInOutcome> => {
      await lockTeam(tx, input.teamId);
      const team = await tx.team.findFirst({
        where: { id: input.teamId, archivedAt: null, ...teamScope(actor) },
        select: { id: true, number: true, name: true, attendedAt: true, competitors: { select: { id: true, attendedAt: true } } },
      });
      if (!team) throw new Refused("NOT_FOUND");
      const label = `${team.number} ${team.name}`;
      const here = team.competitors.filter((seat) => seat.attendedAt).length;
      const total = team.competitors.length;

      if (input.attended) {
        // The first check-in time stands, for each person and for the team.
        if (here === total && (team.attendedAt || total === 0)) return { ok: true, changed: false, team: { id: team.id, label }, detail: "" };
        await tx.competitor.updateMany({ where: { teamId: team.id, attendedAt: null }, data: { attendedAt: now } });
        if (!team.attendedAt) await tx.team.update({ where: { id: team.id }, data: { attendedAt: now } });
        return { ok: true, changed: true, team: { id: team.id, label }, detail: `checked in (${total} of ${total} athletes)` };
      }
      if (here === 0 && !team.attendedAt) return { ok: true, changed: false, team: { id: team.id, label }, detail: "" };
      await tx.competitor.updateMany({ where: { teamId: team.id, NOT: { attendedAt: null } }, data: { attendedAt: null } });
      if (team.attendedAt) await tx.team.update({ where: { id: team.id }, data: { attendedAt: null } });
      return { ok: true, changed: true, team: { id: team.id, label }, detail: "check-in removed" };
    })
  );
}

/** One person arrived — their partner is not counted until they do too. */
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
      await lockTeam(tx, located.teamId);
      const seat = await tx.competitor.findFirst({
        where,
        select: { id: true, fullName: true, attendedAt: true, team: { select: { id: true, number: true, name: true } } },
      });
      if (!seat) throw new Refused("NOT_FOUND");
      const team = { id: seat.team.id, label: `${seat.team.number} ${seat.team.name}` };
      if (Boolean(seat.attendedAt) === input.attended) return { ok: true, changed: false, team, detail: "" };
      await tx.competitor.update({ where: { id: seat.id }, data: { attendedAt: input.attended ? now : null } });
      await syncTeamArrival(tx, seat.team.id);
      return { ok: true, changed: true, team, detail: input.attended ? `${seat.fullName} checked in` : `${seat.fullName}: check-in removed` };
    })
  );
}

/** Ready to compete, or not after all. Arrival at the venue is not read and not written. */
export function setWarmupReady(
  db: PrismaClient,
  actor: CheckInActor,
  input: { teamId: string; ready: boolean },
  now = new Date()
): Promise<CheckInOutcome> {
  if (!canMarkWarmupReady(actor)) return Promise.resolve({ ok: false, error: "FORBIDDEN" });
  return guarded(() =>
    db.$transaction(async (tx): Promise<CheckInOutcome> => {
      await lockTeam(tx, input.teamId);
      const team = await tx.team.findFirst({
        where: { id: input.teamId, archivedAt: null, waitlistedAt: null, ...teamScope(actor) },
        select: { id: true, number: true, name: true, warmupReadyAt: true, series: { select: { status: true, archivedAt: true } } },
      });
      if (!team || team.series.archivedAt) throw new Refused("NOT_FOUND");
      // Nothing changes the floor of a finished competition.
      if (team.series.status === "final") throw new Refused("SERIES_FINISHED");
      const label = { id: team.id, label: `${team.number} ${team.name}` };
      if (Boolean(team.warmupReadyAt) === input.ready) return { ok: true, changed: false, team: label, detail: "" };
      await tx.team.update({ where: { id: team.id }, data: { warmupReadyAt: input.ready ? now : null } });
      return { ok: true, changed: true, team: label, detail: input.ready ? "ready to compete (warm-up)" : "warm-up readiness removed" };
    })
  );
}
