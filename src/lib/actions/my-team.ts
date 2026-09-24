"use server";

import { revalidatePath } from "next/cache";
import { alreadyEntered } from "@/lib/one-entry";
import { prisma } from "@/lib/prisma";
import { normalizeName } from "@/lib/scoring";
import { isValidEmail, normalizeEmail } from "@/lib/security";
import { getCurrentUser } from "@/lib/session";
import { teamEditOpen } from "@/lib/visibility";

export type MyTeamMemberInput = { position: number; fullName: string; email: string };

export type UpdateMyTeamResult =
  | { ok: false; error: "FORBIDDEN" | "TEAM_EDIT_CLOSED" | "NAME_REQUIRED" | "EMAIL_INVALID" | "SHARED_PROFILE" | "ALREADY_ENTERED" }
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
export async function updateMyTeam(members: MyTeamMemberInput[], seriesId: string, teamId: string): Promise<UpdateMyTeamResult> {
  const user = await getCurrentUser();
  if (!user || user.role !== "competitor" || user.viewAs || !seriesId || !teamId || !Array.isArray(members)) return { ok: false, error: "FORBIDDEN" };

  // The account's own competitor row names the one team it may touch — its
  // selected competition, with both ids checked against their membership.
  const mine = await prisma.competitor.findFirst({
    where: { userId: user.id, teamId, team: { seriesId, archivedAt: null, series: { archivedAt: null } } },
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
    select: { id: true, position: true, userId: true, fullName: true, email: true, user: { select: { name: true, email: true } } },
  });

  for (const row of roster) {
    const incoming = members.find(member => member.position === row.position);
    if (row.userId && incoming && (incoming.fullName.trim() !== (row.user?.name ?? row.fullName) || normalizeEmail(incoming.email) !== normalizeEmail(row.user?.email ?? row.email ?? ""))) return { ok: false, error: "SHARED_PROFILE" };
  }

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

  try {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM Series WHERE id = ${seriesId} FOR UPDATE`;
      const unlinked = cleaned.filter(one => !one.row.userId);
      const emails = cleaned.map(one => one.email).filter(Boolean);
      if (new Set(emails).size !== emails.length) throw new Error("ALREADY_ENTERED");
      for (const one of unlinked) {
        if (await alreadyEntered({ seriesId, emails: [one.email], exceptCompetitorId: one.row.id }, tx)) throw new Error("ALREADY_ENTERED");
        // A concurrent sign-in may have linked this seat since the form was loaded.
        const changed = await tx.competitor.updateMany({ where: { id: one.row.id, teamId, userId: null, team: { seriesId, archivedAt: null } },
          data: { fullName: one.fullName, email: one.email, normalizedName: normalizeName(one.fullName) } });
        if (changed.count !== 1) throw new Error("SHARED_PROFILE");
      }
    });
  } catch (error) {
    if (error instanceof Error && (error.message === "ALREADY_ENTERED" || error.message === "SHARED_PROFILE")) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath("/me");

  return { ok: true };
}
