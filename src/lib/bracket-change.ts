import type { PrismaClient } from "@/generated/prisma/client";
import type { Category, Division } from "@/generated/prisma/enums";
import { can, canAssistBracketChange, isBft, teamScope, type CurrentUser } from "@/lib/access";
import { PROOF_TX } from "@/lib/auth-proof";
import { AUDIT, recordAuditIn } from "@/lib/audit";
import { bracketDoor, bracketSide, categoryBlock, levelBlock, type BracketError } from "@/lib/bracket";

// ─────────────────────────────────────────────────────────────────────────────
// CHANGING A TEAM'S CATEGORY OR LEVEL — one path for the athlete and for the
// staff who help them, with the same discipline as every other team change
// (membership-change.ts, staff-membership.ts):
//
//   · WHO is decided here, not only by the caller: an athlete changes the team
//     they sit on, with `athleteHome.editTeam`; staff change a team inside
//     their scope (teamScope — a gym its own, never another gym's), with
//     `registrations.bracket`, and only after confirming the athlete asked
//     for it and approves. An athlete's account is never "staff".
//   · everything else is decided INSIDE one transaction, AFTER the
//     competition lock, on the team as re-read there (bracket.ts): WHEN — the
//     competition's own cutoff for the athlete and their gym, "until the team
//     has a score" for BFT MENA and event staff — the Pro rule, the category
//     rule;
//   · the page says what bracket it was showing; a team that has moved since
//     is STALE_BRACKET, never silently overwritten. Asking for the bracket the
//     team already has changes nothing and says so — a double tap is safe;
//   · the audit line — who, which team, from what to what, on whose say — is
//     written in the same transaction: no line, no change.
//
// WHAT IT WRITES: the team's category and level, and the same two on each
// signed-in member's entry for this competition (their "Your competition
// entry" card). Nothing else — the wave, the station, the payment, the
// entrance check-in and the warm-up readiness all stay exactly as they were.
// ─────────────────────────────────────────────────────────────────────────────

export type BracketActor = Pick<CurrentUser, "id" | "role" | "studioId" | "permissions">;

export type BracketInput = {
  teamId: string;
  category: Category;
  division: Division;
  /** The bracket the page was showing when the change was asked for. */
  expected: { category: Category; division: Division };
} & (
  | { by: "athlete" }
  /** `athleteApproved`: staff confirmed the athlete asked for this and approves. */
  | { by: "staff"; athleteApproved: boolean }
);

export type BracketOutcome =
  | { ok: true; changed: boolean; category: Category; division: Division }
  | { ok: false; error: BracketError };

class Refused extends Error {
  constructor(readonly code: BracketError) {
    super(code);
  }
}

export async function changeBracket(db: PrismaClient, actor: BracketActor, input: BracketInput, now = new Date()): Promise<BracketOutcome> {
  if (input.by === "athlete") {
    if (actor.role !== "competitor" || !can(actor, "athleteHome.editTeam")) return { ok: false, error: "FORBIDDEN" };
  } else {
    if (!canAssistBracketChange(actor)) return { ok: false, error: "FORBIDDEN" };
    if (input.athleteApproved !== true) return { ok: false, error: "APPROVAL_REQUIRED" };
  }

  // Their own team, or a team inside the staff member's scope. Anything else
  // does not exist as far as this person is concerned.
  const where = {
    id: input.teamId,
    archivedAt: null,
    ...(input.by === "athlete" ? { competitors: { some: { userId: actor.id } } } : teamScope(actor)),
  };
  const located = await db.team.findFirst({ where, select: { seriesId: true } });
  if (!located) return { ok: false, error: "NOT_FOUND" };

  try {
    return await db.$transaction(async (tx): Promise<BracketOutcome> => {
      await tx.$queryRaw`SELECT id FROM Series WHERE id = ${located.seriesId} FOR UPDATE`;
      const team = await tx.team.findFirst({
        where,
        select: {
          id: true, seriesId: true, number: true, name: true, category: true, division: true, archivedAt: true, waveId: true,
          waveRef: { select: { status: true } },
          score: { select: { id: true } },
          series: { select: { status: true, archivedAt: true, competitionDate: true, teamEditCloseHours: true } },
          competitors: { select: { userId: true, user: { select: { athleteProfile: { select: { sex: true } } } } } },
        },
      });
      if (!team) throw new Refused("NOT_FOUND");

      // Already what was asked for: nothing to do, and nothing to audit.
      if (team.category === input.category && team.division === input.division) {
        return { ok: true, changed: false, category: team.category, division: team.division };
      }
      if (team.category !== input.expected.category || team.division !== input.expected.division) throw new Refused("STALE_BRACKET");

      const door = bracketDoor({
        archivedAt: team.archivedAt, waveId: team.waveId, waveStatus: team.waveRef?.status ?? null,
        scored: Boolean(team.score), seriesStatus: team.series.status, seriesArchived: Boolean(team.series.archivedAt),
        competitionDate: team.series.competitionDate, closeHours: team.series.teamEditCloseHours,
      }, bracketSide(actor, input.by), now);
      if (!door.open) throw new Refused(door.reason);

      const level = levelBlock(team.division, input.division, isBft(actor));
      if (level) throw new Refused(level);
      if (input.category !== team.category) {
        const category = categoryBlock(input.category, team.competitors.map((seat) => seat.user?.athleteProfile?.sex ?? null));
        if (category) throw new Refused(category);
      }

      // Only the bracket. Check-in, warm-up, wave, station and payment are
      // other facts and are not in this write.
      await tx.team.update({ where: { id: team.id }, data: { category: input.category, division: input.division } });
      const members = team.competitors.map((seat) => seat.userId).filter((id): id is string => Boolean(id));
      if (members.length) {
        await tx.seriesParticipant.updateMany({
          where: { seriesId: team.seriesId, userId: { in: members } },
          data: { category: input.category, division: input.division },
        });
      }

      await recordAuditIn(tx, {
        actorId: actor.id,
        action: AUDIT.bracketChanged,
        targetType: "team",
        targetId: team.id,
        targetLabel: `${team.number} ${team.name}`,
        detail: [
          team.category === input.category ? `category ${team.category} (unchanged)` : `category ${team.category} → ${input.category}`,
          team.division === input.division ? `level ${team.division} (unchanged)` : `level ${team.division} → ${input.division}`,
          input.by === "athlete"
            ? "changed by the athlete, on their own team"
            : "staff-assisted: confirmed that the athlete asked for this change and approves it",
        ].join(" · "),
      });
      return { ok: true, changed: true, category: input.category, division: input.division };
    }, PROOF_TX);
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.code };
    throw error;
  }
}
