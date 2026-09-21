import "server-only";

import type { CurrentUser } from "@/lib/session";
import { isStudio, teamScope } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT STAFF NEED TO KNOW BEFORE SWAPPING SOMEBODY.
//
// The read half of `actions/team-swap.ts`, which owns the rules. This asks the
// same three questions in the same order so the screen can say WHY a swap is
// refused instead of hiding the panel — a greyed-out reason is a working
// explanation, a missing panel is a support call.
//
// The two must agree. If a guard is added to the action, it belongs here too;
// the only cost of them drifting is a button that looks available and is not.
// ─────────────────────────────────────────────────────────────────────────────

export type SwapDoor =
  | { open: true }
  | { open: false; reason: "SERIES_FINISHED" | "TEAM_ALREADY_SCORED" | "WAVE_STARTED" };

export type SwapSeat = {
  competitorId: string;
  fullName: string;
  teamNumber: number;
  teamName: string;
  door: SwapDoor;
};

/** Can this seat be changed, and if not, what closed it? */
export async function readSwapSeat(
  competitorId: string,
  user: CurrentUser
): Promise<SwapSeat | null> {
  const seat = await prisma.competitor.findFirst({
    where: { id: competitorId, team: { archivedAt: null, ...teamScope(user) } },
    select: {
      id: true,
      fullName: true,
      team: {
        select: {
          number: true,
          name: true,
          waveId: true,
          waveRef: { select: { status: true } },
          score: { select: { id: true } },
          series: { select: { status: true } },
        },
      },
    },
  });
  if (!seat) return null;
  const team = seat.team;

  const door: SwapDoor =
    team.series.status === "final"
      ? { open: false, reason: "SERIES_FINISHED" }
      : team.score
        ? { open: false, reason: "TEAM_ALREADY_SCORED" }
        : team.waveId && team.waveRef?.status !== "pending"
          ? { open: false, reason: "WAVE_STARTED" }
          : { open: true };

  return {
    competitorId: seat.id,
    fullName: seat.fullName,
    teamNumber: team.number,
    teamName: team.name,
    door,
  };
}

export type SwapCandidate = { id: string; name: string; studioName: string | null };

/** How many names the picker will carry. Past this, staff type the name in. */
const CANDIDATE_LIMIT = 200;

/**
 * Athletes who could take the seat: approved accounts not already entered in
 * this competition. A studio sees its own; BFT MENA sees everyone, because on
 * the day the substitute is as likely to come from another studio.
 *
 * This is a STAFF read of athlete accounts, and it still carries only a name
 * and a studio — not because of the finder's privacy rule (that governs one
 * athlete reading another) but because a name is all a picker needs.
 */
export async function listSwapCandidates(
  user: CurrentUser,
  seriesId: string
): Promise<SwapCandidate[]> {
  const rows = await prisma.user.findMany({
    where: {
      role: "competitor",
      approvalStatus: "approved",
      archivedAt: null,
      status: { not: "disabled" },
      ...(isStudio(user) && user.studioId ? { studioId: user.studioId } : {}),
      NOT: { competitors: { some: { team: { seriesId, archivedAt: null } } } },
    },
    orderBy: { name: "asc" },
    take: CANDIDATE_LIMIT,
    select: { id: true, name: true, email: true, studio: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? row.email,
    studioName: row.studio?.name ?? null,
  }));
}
