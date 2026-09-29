"use server";

import { revalidatePath } from "next/cache";

import { can } from "@/lib/access";
import { PROOF_TX } from "@/lib/auth-proof";
import { AUDIT, recordAuditIn } from "@/lib/audit";
import { syncAfterMembershipChange } from "@/lib/membership-sync";
import { membershipRights, teamChangeWindow } from "@/lib/ownership";
import { prisma } from "@/lib/prisma";
import { normalizeName } from "@/lib/scoring";
import { normalizeEmail } from "@/lib/security";
import { getCurrentUser } from "@/lib/session";

export type MyTeamMemberInput = { position: number; fullName: string; email: string };

export type UpdateMyTeamResult =
  | {
      ok: false;
      error:
        | "FORBIDDEN" | "TEAM_EDIT_CLOSED" | "NAME_REQUIRED" | "SHARED_PROFILE"
        | "NOT_REGISTRANT" | "OWNERSHIP_UNKNOWN" | "EMAIL_IS_A_NEW_PERSON" | "STALE_MEMBERSHIP";
    }
  | { ok: true };

class Refused extends Error {
  constructor(readonly code: Extract<UpdateMyTeamResult, { ok: false }>["error"]) {
    super(code);
  }
}

/**
 * The registrant CORRECTING their partner's NAME — a typo — on a seat nobody
 * has signed in to yet. That is all this does.
 *
 * An EMAIL is who a seat is (seat-identity.ts): a different email is a
 * different person, whether or not the name changes with it, and whether it
 * comes in one request or two. So an email change is refused here
 * (EMAIL_IS_A_NEW_PERSON) and belongs to "Replace my partner"
 * (membership-change.ts) — with its switch, window, version, duplicate check,
 * clean seat and audit — or to BFT MENA. A seat somebody has signed in to
 * belongs to their account (SHARED_PROFILE).
 *
 * Only by the registrant (ownership.ts); only until 24 hours before the
 * competition (D3a — an athlete is never Full access); decided in one
 * transaction under the competition lock, on the team as it is then; the
 * page's membership version must still be the team's; audited in the same
 * transaction.
 */
export async function updateMyTeam(members: MyTeamMemberInput[], seriesId: string, teamId: string, expectedVersion?: number): Promise<UpdateMyTeamResult> {
  const user = await getCurrentUser();
  if (!user || user.role !== "competitor" || user.viewAs || !seriesId || !teamId || !Array.isArray(members)) return { ok: false, error: "FORBIDDEN" };
  // The Athlete role's own key: taking it away (a lock, or a custom role) stops edits.
  if (!can(user, "athleteHome.editTeam")) return { ok: false, error: "FORBIDDEN" };

  try {
    const changed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Series WHERE id = ${seriesId} FOR UPDATE`;
      const team = await tx.team.findFirst({
        where: { id: teamId, seriesId, archivedAt: null, series: { archivedAt: null }, competitors: { some: { userId: user.id } } },
        select: {
          id: true, number: true, name: true, membershipVersion: true,
          ownership: true, registrantEmail: true, registrantUserId: true,
          series: { select: { status: true, competitionDate: true } },
          competitors: { orderBy: { position: "asc" }, select: { id: true, position: true, userId: true, fullName: true, email: true } },
        },
      });
      if (!team) throw new Refused("FORBIDDEN");
      if (team.series.status === "final" || !teamChangeWindow(team.series.competitionDate, new Date(), false).open) throw new Refused("TEAM_EDIT_CLOSED");
      if (expectedVersion !== undefined && expectedVersion !== team.membershipVersion) throw new Refused("STALE_MEMBERSHIP");

      const rights = membershipRights(team, user.id);
      if (rights.reason === "OWNERSHIP_UNKNOWN" || rights.reason === "JOINT_TEAM" || rights.reason === "REGISTRANT_UNRESOLVED") throw new Refused("OWNERSHIP_UNKNOWN");
      if (rights.role !== "registrant") throw new Refused("NOT_REGISTRANT");

      const lines: string[] = [];
      for (const seat of team.competitors) {
        const incoming = members.find((member) => member.position === seat.position);
        if (!incoming) continue;
        const fullName = (incoming.fullName ?? "").trim();
        const email = normalizeEmail(incoming.email ?? "") || null;
        const emailChanged = email !== (seat.email ? normalizeEmail(seat.email) : null);
        const nameChanged = normalizeName(fullName) !== normalizeName(seat.fullName);
        if (!nameChanged && !emailChanged) continue;
        // Their own seat, or a seat somebody has signed in to: their account's.
        if (seat.userId) throw new Refused("SHARED_PROFILE");
        // A different email is a different person: never a correction.
        if (emailChanged) throw new Refused("EMAIL_IS_A_NEW_PERSON");
        if (!fullName) throw new Refused("NAME_REQUIRED");
        await tx.competitor.update({ where: { id: seat.id }, data: { fullName, normalizedName: normalizeName(fullName) } });
        lines.push(`position ${seat.position}: name ${seat.fullName} → ${fullName}`);
      }
      if (!lines.length) return false;

      // The partner snapshots carry the name: bring them in step.
      await syncAfterMembershipChange(tx, { teamId: team.id, seriesId, departedUserIds: [] });
      await recordAuditIn(tx, {
        actorId: user.id, action: AUDIT.teamPartnerCorrected, targetType: "team", targetId: team.id,
        targetLabel: `${team.number} ${team.name}`, detail: lines.join(" · "),
      });
      return true;
    }, PROOF_TX);
    if (changed) revalidatePath("/me");
    return { ok: true };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.code };
    throw error;
  }
}
