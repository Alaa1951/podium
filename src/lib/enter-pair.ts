import "server-only";
import { prisma } from "@/lib/prisma";
import { loadSeriesAthlete } from "@/lib/participation";
import { createTeam } from "@/lib/team-create";
import { entryPlace } from "@/lib/visibility";
export type EnterPairOutcome =
  | { entered: true; teamId: string; teamNumber: number; waitlisted: boolean }
  | { entered: false; reason: EnterPairReason };

export type EnterPairReason =
  | "NO_COMPETITION"
  | "NO_PARTNER"
  | "PARTNER_CHOSE_ANOTHER"
  | "NOT_APPROVED"
  | "INCOMPLETE_PROFILE"
  | "MIXED_LEVELS"
  | "CATEGORY_MISMATCH"
  | "ALREADY_ENTERED"
  | "COMPETITION_CLOSED";


export async function enterPairIfReady(userId: string, seriesId?: string): Promise<EnterPairOutcome> {
  if (!seriesId) return { entered: false, reason: "NO_COMPETITION" };
  const me = await loadSeriesAthlete(userId, seriesId);
  if (!me || me.role !== "competitor" || me.approvalStatus !== "approved" || me.status !== "active" || me.archivedAt) return { entered: false, reason: "NOT_APPROVED" };
  const partnerId = me.athleteProfile.partnerUserId;
  if (!partnerId) return { entered: false, reason: "NO_PARTNER" };
  const partner = await loadSeriesAthlete(partnerId, seriesId);
  if (!partner) return { entered: false, reason: "PARTNER_CHOSE_ANOTHER" };
  if (partner.role !== "competitor" || partner.approvalStatus !== "approved" || partner.status !== "active" || partner.archivedAt) return { entered: false, reason: "NOT_APPROVED" };
  const mine = me.athleteProfile, theirs = partner.athleteProfile;
  if (theirs.partnerUserId !== me.id) return { entered: false, reason: "NO_PARTNER" };
  const series = await prisma.series.findFirst({ where: { id: seriesId, archivedAt: null, isActive: true, status: { not: "final" } } });
  if (!series) return { entered: false, reason: "COMPETITION_CLOSED" };
  if (!mine.division || !mine.category || !theirs.division || !theirs.category) return { entered: false, reason: "INCOMPLETE_PROFILE" };
  if (mine.division !== theirs.division) return { entered: false, reason: "MIXED_LEVELS" };
  if (mine.category !== theirs.category) return { entered: false, reason: "CATEGORY_MISMATCH" };
  const sexes = [mine.sex, theirs.sex];
  if ((mine.category === "Womens" && sexes.includes("m")) || (mine.category === "Mens" && sexes.includes("f"))) return { entered: false, reason: "CATEGORY_MISMATCH" };
  const signedUpAt = me.signupAt > partner.signupAt ? me.signupAt : partner.signupAt;
  const waitlisted = entryPlace({ signedUpAt, registrationClosesAt: series.registrationClosesAt }) === "waiting_list";
  const result = await createTeam(prisma, {
    seriesId, name: (mine.teamName || theirs.teamName || me.name || me.email).toUpperCase(),
    category: mine.category, division: mine.division, studioId: me.studioId ?? partner.studioId,
    source: "signup", paymentStatus: "pending", waitlistedAt: waitlisted ? new Date() : null,
    seats: [me, partner].map((athlete, i) => ({ position: i + 1, userId: athlete.id,
      fullName: athlete.name ?? athlete.email, email: athlete.email, phone: athlete.phone,
      dateOfBirth: athlete.athleteProfile.dateOfBirth, shirtSize: athlete.athleteProfile.shirtSize,
      bftMember: athlete.athleteProfile.bftMember, studioId: athlete.studioId })),
  });
  return result.ok ? { entered: true, teamId: result.id, teamNumber: result.number, waitlisted } : { entered: false, reason: "ALREADY_ENTERED" };
}

export async function enterApprovedPairs(userId: string): Promise<EnterPairOutcome> {
  const entries = await prisma.seriesParticipant.findMany({ where: { userId, archivedAt: null }, select: { seriesId: true } });
  let outcome: EnterPairOutcome = { entered: false, reason: "NO_COMPETITION" };
  for (const entry of entries) {
    const result = await enterPairIfReady(userId, entry.seriesId);
    if (result.entered || !outcome.entered) outcome = result;
  }
  return outcome;
}
