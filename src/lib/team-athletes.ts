import "server-only";

import { can, isBft, teamScope, type CurrentUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { membershipBarrier, registrantSeat, teamChangesCloseLabel, teamChangeWindow } from "@/lib/ownership";

// What the Athletes section of a team's page needs: each athlete as the page
// shows them (a signed-in seat reads as its account, queries.ts › toRosterRow),
// and what this person may do about them right now. The rules themselves are
// the server's (staff-membership.ts › correctSeat, swapSeat); this only lets
// the panel say up front what the action would answer.

export type AthleteFacts = {
  id: string;
  position: number;
  fullName: string;
  email: string | null;
  phone: string | null;
  /** yyyy-mm-dd, or "". */
  dateOfBirth: string;
  /** Signs in to PODIUM: name, email and phone are the account's. */
  linked: boolean;
  /** Registered the team. */
  registrant: boolean;
};

export type TeamAthletes = {
  teamId: string;
  version: number;
  athletes: AthleteFacts[];
  /** Team changes have closed for this person without the athlete's request. */
  closed: boolean;
  /** When they close, in Qatar time. */
  closesAt: string;
  /** What stops putting somebody else in a seat, if anything. */
  barrier: "SERIES_FINISHED" | "TEAM_ALREADY_SCORED" | "WAVE_STARTED" | null;
  /** BFT MENA Full access: corrects anything, never needs the athlete's tick. */
  full: boolean;
  bft: boolean;
  canCorrect: boolean;
  canReplace: boolean;
};

export async function loadTeamAthletes(teamId: string, user: CurrentUser, locale: string): Promise<TeamAthletes | null> {
  if (user.viewAs || !can(user, "registrations.edit")) return null;
  const team = await prisma.team.findFirst({
    where: { id: teamId, archivedAt: null, ...teamScope(user) },
    select: {
      id: true, archivedAt: true, waveId: true, membershipVersion: true, ownership: true, registrantEmail: true, registrantUserId: true,
      waveRef: { select: { status: true } }, score: { select: { id: true } },
      series: { select: { status: true, archivedAt: true, competitionDate: true } },
      competitors: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, fullName: true, email: true, phone: true, dateOfBirth: true, userId: true, user: { select: { name: true, email: true, phone: true } } },
      },
    },
  });
  if (!team) return null;
  const full = can(user, "registrations.changeAfterClose");
  const barrier = membershipBarrier({
    archivedAt: team.archivedAt, waveId: team.waveId, waveStatus: team.waveRef?.status ?? null,
    scored: Boolean(team.score), seriesStatus: team.series.status, seriesArchived: Boolean(team.series.archivedAt),
  });
  const registrant = registrantSeat(team);
  return {
    teamId: team.id,
    version: team.membershipVersion,
    athletes: team.competitors.map((seat) => ({
      id: seat.id,
      position: seat.position,
      fullName: seat.user?.name ?? seat.fullName,
      email: seat.user?.email ?? seat.email,
      phone: seat.user ? seat.user.phone : seat.phone,
      dateOfBirth: seat.dateOfBirth ? seat.dateOfBirth.toISOString().slice(0, 10) : "",
      linked: Boolean(seat.userId && seat.user),
      registrant: registrant?.id === seat.id,
    })),
    closed: !teamChangeWindow(team.series.competitionDate, new Date(), full).open,
    closesAt: teamChangesCloseLabel(team.series.competitionDate, locale),
    barrier: barrier.open ? null : barrier.reason === "NOT_FOUND" ? "SERIES_FINISHED" : barrier.reason === "TEAM_EDIT_CLOSED" ? null : barrier.reason,
    full,
    bft: isBft(user),
    canCorrect: true,
    canReplace: can(user, "registrations.pair"),
  };
}
