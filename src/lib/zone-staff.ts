import "server-only";

import { parseOverrides, resolveEffectivePermissions } from "@/lib/permissions/resolve";
import { DEFAULT_ROLE_FOR, systemRole } from "@/lib/permissions/system-roles";
import { formatQatarDayKey } from "@/lib/qatar-time";
import { prisma } from "@/lib/prisma";
import { canAssignZoneScorePost, canViewZoneScoreSheet } from "@/lib/zone-sheet-access";
import type { CurrentUser } from "@/lib/access";

// ─────────────────────────────────────────────────────────────────────────────
// ZONE STAFF — who works which zone of a competition.
//
// Access on the floor is per ZONE, not per wave: several waves pass through a
// zone, and its people stay put for the whole competition. Each zone has one
// or more leaders (they place the judges on stations, score any station),
// judges (score the team on their station) and reserves (the same as judges;
// the label is for organising people).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * People who may be put on a zone, with eligibility for each kind of post.
 * Resolve roles and personal locks together so the picker matches the action.
 */
export async function judgeCandidates() {
  const roles = await prisma.accessRole.findMany({ select: { key: true, name: true, permissions: true } });
  const people = await prisma.user.findMany({
    where: {
      status: "active",
      archivedAt: null,
      // A sign-up still waiting holds only the general pages, so putting it on
      // a zone would fail (NOT_A_JUDGE) — leave it off the list until approved.
      approvalStatus: "approved",
      role: { not: "competitor" },
    },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: {
      id: true, name: true, email: true, role: true, permissionOverrides: true,
      accessRoles: { select: { accessRole: { select: { key: true, name: true, permissions: true } } } },
    },
  });
  return people.flatMap((person) => {
    const held = person.accessRoles.map(({ accessRole }) => accessRole);
    const defaultKey = DEFAULT_ROLE_FOR[person.role];
    const fallback = roles.find((role) => role.key === defaultKey) ?? (defaultKey ? systemRole(defaultKey) : undefined);
    const permissions = resolveEffectivePermissions({
      accountType: person.role,
      approved: true,
      roles: held.length ? held : fallback ? [fallback] : [],
      overrides: parseOverrides(person.permissionOverrides),
    });
    const user = { role: person.role, permissions };
    const canJudge = canAssignZoneScorePost(user, "judge");
    const canLead = canAssignZoneScorePost(user, "leader");
    return canJudge || canLead ? [{ id: person.id, name: person.name, email: person.email, canJudge, canLead }] : [];
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

/**
 * Whether a person works a zone of a running competition — or of one whose
 * day is today (Qatar) and has not been started yet. Their home is then the
 * judge sheet, where the day's waves are waiting for them before the first
 * one goes.
 */
export async function hasLiveZonePost(
  userId: string,
  now = new Date(),
  sheetUser?: Pick<CurrentUser, "role" | "permissions">
): Promise<boolean> {
  const posts = await prisma.zoneStaff.findMany({
    where: { userId, series: { status: { in: ["live", "scheduled"] }, archivedAt: null } },
    select: { position: true, series: { select: { status: true, competitionDate: true } } },
  });
  const today = formatQatarDayKey(now);
  return posts.some(({ position, series }) =>
    (!sheetUser || canViewZoneScoreSheet(sheetUser, position)) &&
    (series.status === "live" || formatQatarDayKey(series.competitionDate) === today)
  );
}
