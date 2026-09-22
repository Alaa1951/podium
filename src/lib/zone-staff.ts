import "server-only";

import { normalizeStoredPermissions } from "@/lib/permissions/catalog";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// ZONE STAFF — who works which zone of a competition.
//
// Access on the floor is per ZONE, not per wave: several waves pass through a
// zone, and its people stay put for the whole competition. Each zone has one
// leader (places the judges on stations, scores any station), judges (score
// the team on their station) and reserves (the same as judges; the label is
// for organising people).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * People who may be put on a zone: active accounts holding a role that
 * carries the judge sheet. The Judge role is the usual one; a custom role
 * that includes the sheet counts the same.
 */
export async function judgeCandidates() {
  const roles = await prisma.accessRole.findMany({ select: { id: true, permissions: true } });
  const judging = roles
    .filter((role) => normalizeStoredPermissions(role.permissions).includes("judgeSheet.view"))
    .map((role) => role.id);
  if (!judging.length) return [];
  return prisma.user.findMany({
    where: {
      status: "active",
      archivedAt: null,
      accessRoles: { some: { accessRoleId: { in: judging } } },
    },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, name: true, email: true },
  });
}

/** Every zone of a competition with the people on it. */
export async function listZoneStaff(seriesId: string) {
  return prisma.zone.findMany({
    where: { seriesId },
    orderBy: { number: "asc" },
    select: {
      id: true,
      number: true,
      name: true,
      staff: {
        orderBy: [{ position: "asc" }, { station: "asc" }],
        select: {
          id: true,
          position: true,
          station: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
}

/** A person's posts on competitions that are scheduled or running. */
export async function judgePostsFor(userId: string) {
  return prisma.zoneStaff.findMany({
    where: { userId, series: { status: { in: ["scheduled", "live"] }, archivedAt: null } },
    orderBy: [{ series: { competitionDate: "asc" } }, { zone: { number: "asc" } }],
    select: {
      id: true,
      position: true,
      station: true,
      seriesId: true,
      series: { select: { id: true, name: true, slug: true, status: true, waveCapacity: true } },
      zone: { select: { id: true, number: true, name: true } },
    },
  });
}

/** Whether a person works a zone of a running competition — their home is then the judge sheet. */
export async function hasLiveZonePost(userId: string): Promise<boolean> {
  const post = await prisma.zoneStaff.findFirst({
    where: { userId, series: { status: "live" } },
    select: { id: true },
  });
  return !!post;
}
