import "server-only";

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import type { Role } from "@/generated/prisma/enums";
import { authOptions } from "@/lib/auth";
import { can, DEFAULT_STUDIO_PERMISSIONS, type CurrentUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";

// Resolving who is asking. The rules about what they may then do live in
// access.ts, which is pure and tested on its own — this file only reads the
// session and applies them.

export type { CurrentUser } from "@/lib/access";
export {
  accountScope,
  canCreateAccount,
  canEditScore,
  canManageAccounts,
  canManageEvent,
  canRegisterTeams,
  canWriteScore,
  isAdmin,
  isCompetitor,
  isStudio,
  scoreWriteBudget,
  teamScope,
} from "@/lib/access";

/**
 * Where a role belongs when it lands somewhere it may not be.
 *
 * Every console route used to redirect a refusal to "/", which is itself
 * admin-only — so a studio or a competitor signing in bounced between the two
 * forever. A refusal has to land somewhere the refused role can actually stand.
 */
export function homeFor(role: Role): string {
  if (role === "studio") return "/studio";
  if (role === "competitor") return "/me";
  return "/";
}

/**
 * The same, resolved for a PERSON rather than a role: an account holding a
 * wave-scorer grant belongs on that wave's score sheet, whatever role the
 * account carries. Checked on every refused route, so a scorer typing the
 * console's address lands on their sheet instead of in a hallway.
 */
export async function homeForUser(user: CurrentUser): Promise<string> {
  try {
    const grant = await prisma.waveAccess.findFirst({
      where: { userId: user.id, wave: { series: { status: "live" } } },
      select: { id: true },
    });
    if (grant) return "/my-wave";
  } catch {
    // A refused route must never turn into a 500 because the grant lookup
    // hiccuped — the role's ordinary home is always a safe answer.
  }
  return homeFor(user.role);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  // A token can outlive a change of status by up to its refresh window, so the
  // check is repeated here rather than trusted from sign-in time.
  if (session.user.status !== "active") return null;

  // Each role has its own session length — staff twelve hours, a competitor
  // twenty-four. The cookie is cut to the longest of them, so the shorter
  // deadlines are kept here, on every request, rather than by the cookie.
  if (session.user.expiresAt && Date.now() > session.user.expiresAt) return null;

  // Permissions resolve from the account's access role when it carries one;
  // otherwise the role's own defaults apply. Admins bypass in can().
  let permissions: string[] = [];
  if (session.user.role === "admin") {
    permissions = ["*"];
  } else if (session.user.accessRoleId) {
    const accessRole = await prisma.accessRole.findUnique({
      where: { id: session.user.accessRoleId },
      select: { permissions: true },
    });
    permissions = (accessRole?.permissions as string[] | undefined) ?? [];
  } else if (session.user.role === "studio") {
    permissions = DEFAULT_STUDIO_PERMISSIONS;
  }

  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? null,
    role: session.user.role,
    studioId: session.user.studioId,
    locale: session.user.locale,
    permissions,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(await homeForUser(user));
  return user;
}

/**
 * Gate a screen or action by a CATALOG permission key (see access.ts).
 * Admins pass everything; everyone else passes when their resolved permission
 * list carries the key. A refusal lands where that person belongs.
 */
export async function requirePermission(permission: string): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, permission)) redirect(await homeForUser(user));
  return user;
}
