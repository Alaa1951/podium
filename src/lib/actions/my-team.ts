"use server";

import { prisma } from "@/lib/prisma";
import { normalizeName } from "@/lib/scoring";
import { isValidEmail, normalizeEmail } from "@/lib/security";
import { getCurrentUser } from "@/lib/session";
import { teamEditOpen } from "@/lib/visibility";

export type MyTeamMemberInput = { position: number; fullName: string; email: string };

export type UpdateMyTeamResult =
  | { ok: false; error: "FORBIDDEN" | "TEAM_EDIT_CLOSED" | "NAME_REQUIRED" | "EMAIL_INVALID" }
  | { ok: true };

/**
 * A member correcting WHO stands on their team — either slot's name and email.
 *
 * The door closes on a clock, not on a mood: changes are possible until the
 * event is 24 hours away, and from that point on (and once it has started)
 * the roster is what it is. Both members of the pair may edit either slot —
 * the account proves you belong to the team, not that you own one seat.
 *
 * Everything is checked here, on the server: membership of the team, the
 * cutoff, and a name for every member. Emails are optional and must be
 * well-formed — they are contact details, not identity, so no uniqueness
 * gate stands in the way of a correction.
 */
export async function updateMyTeam(members: MyTeamMemberInput[]): Promise<UpdateMyTeamResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "FORBIDDEN" };

  // The account's own competitor row names the one team it may touch — its
  // most recent entry, which is also the team /me puts in front of them.
  const mine = await prisma.competitor.findFirst({
    where: { userId: user.id },
    orderBy: { team: { series: { competitionDate: "desc" } } },
    select: {
      id: true,
      teamId: true,
      team: {
        select: {
          seriesId: true,
          series: { select: { competitionDate: true, teamEditCloseHours: true } },
        },
      },
    },
  });
  if (!mine) return { ok: false, error: "FORBIDDEN" };

  // The door closes on the series' own clock — its configured hours before
  // the competition, and from then on (including once it has started).
  const door = teamEditOpen({
    competitionDate: mine.team.series.competitionDate,
    teamEditCloseHours: mine.team.series.teamEditCloseHours,
    now: new Date(),
  });
  if (!door.open) return { ok: false, error: "TEAM_EDIT_CLOSED" };

  const roster = await prisma.competitor.findMany({
    where: { teamId: mine.teamId },
    orderBy: { position: "asc" },
    select: { id: true, position: true },
  });

  // A name for everyone, and a well-formed email wherever one was given.
  type Cleaned = { row: (typeof roster)[number]; fullName: string; email: string | null; error: "NAME_REQUIRED" | "EMAIL_INVALID" | null };
  const cleaned: Cleaned[] = roster.map((row) => {
    const incoming = members.find((member) => member.position === row.position);
    const fullName = (incoming?.fullName ?? "").trim();
    const email = normalizeEmail(incoming?.email ?? "");
    if (!fullName) return { row, fullName, email: null, error: "NAME_REQUIRED" as const };
    if (incoming?.email.trim() && !isValidEmail(email)) {
      return { row, fullName, email: null, error: "EMAIL_INVALID" as const };
    }
    return { row, fullName, email: email || null, error: null };
  });
  const firstError = cleaned.find(
    (one): one is Cleaned & { error: "NAME_REQUIRED" | "EMAIL_INVALID" } => one.error !== null
  );
  if (firstError) return { ok: false, error: firstError.error };

  await prisma.$transaction(
    cleaned.map((one) =>
      prisma.competitor.update({
        where: { id: one.row.id },
        data: { fullName: one.fullName, email: one.email, normalizedName: normalizeName(one.fullName) },
      })
    )
  );

  return { ok: true };
}
