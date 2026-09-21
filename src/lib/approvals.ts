import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { can, isBft, isStudio, type CurrentUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// THE APPROVAL QUEUE.
//
// A sign-up waits here once its owner has proved the email address. Who sees
// it:
//   • BFT MENA — every request.
//   • A studio — requests that named it, except a request to BE a Gym/Studio,
//     which only BFT MENA decides.
// A request naming a studio shows in both places; whoever acts first decides.
// ─────────────────────────────────────────────────────────────────────────────

/** The requests this viewer may see and decide, or null for none at all. */
export function approvalScope(user: CurrentUser): Prisma.UserWhereInput | null {
  if (!can(user, "approvals.view")) return null;
  const base: Prisma.UserWhereInput = {
    approvalStatus: "pending",
    signupType: { not: null },
    emailVerified: { not: null },
    archivedAt: null,
  };
  if (isBft(user)) return base;
  if (isStudio(user) && user.studioId) {
    return {
      ...base,
      requestedStudioId: user.studioId,
      OR: [{ requestedRoleKey: null }, { requestedRoleKey: { not: "gym-studio" } }],
    };
  }
  return null;
}

export type PendingSignup = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  signupType: string | null;
  requestedRoleKey: string | null;
  requestedStudioId: string | null;
  requestedStudioName: string | null;
  requestedStudioLabel: string | null;
  requestedCity: string | null;
  /** The competition they chose at sign-up, if any — approving may enter them. */
  requestedSeriesName: string | null;
  signupAt: string | null;
  athlete: {
    division: string | null;
    category: string | null;
    sex: string | null;
    dateOfBirth: string | null;
    lookingForPartner: boolean;
    partnerName: string | null;
    partnerEmail: string | null;
    partnerLinked: boolean;
  } | null;
};

const day = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null);

/** Every request waiting on this viewer, oldest first. */
export async function listPendingSignups(user: CurrentUser): Promise<PendingSignup[]> {
  const where = approvalScope(user);
  if (!where) return [];
  const rows = await prisma.user.findMany({
    where,
    orderBy: { signupAt: "asc" },
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      signupType: true,
      signupAt: true,
      requestedRoleKey: true,
      requestedStudioId: true,
      requestedStudioName: true,
      requestedCity: true,
      requestedStudio: { select: { name: true } },
      requestedSeries: { select: { name: true } },
      athleteProfile: {
        select: {
          division: true,
          category: true,
          sex: true,
          dateOfBirth: true,
          lookingForPartner: true,
          partnerName: true,
          partnerEmail: true,
          partnerUserId: true,
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    signupType: row.signupType,
    requestedRoleKey: row.requestedRoleKey,
    requestedStudioId: row.requestedStudioId,
    requestedStudioName: row.requestedStudioName,
    requestedStudioLabel: row.requestedStudio?.name ?? null,
    requestedCity: row.requestedCity,
    requestedSeriesName: row.requestedSeries?.name ?? null,
    signupAt: day(row.signupAt),
    athlete: row.athleteProfile
      ? {
          division: row.athleteProfile.division,
          category: row.athleteProfile.category,
          sex: row.athleteProfile.sex,
          dateOfBirth: day(row.athleteProfile.dateOfBirth),
          lookingForPartner: row.athleteProfile.lookingForPartner,
          partnerName: row.athleteProfile.partnerName,
          partnerEmail: row.athleteProfile.partnerEmail,
          partnerLinked: Boolean(row.athleteProfile.partnerUserId),
        }
      : null,
  }));
}

/** How many requests wait on this viewer — the badge on the menu. */
export async function countPendingSignups(user: CurrentUser): Promise<number> {
  const where = approvalScope(user);
  if (!where) return 0;
  return prisma.user.count({ where });
}
