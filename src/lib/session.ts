import "server-only";
import { cache } from "react";

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import type { Role } from "@/generated/prisma/enums";
import { authOptions } from "@/lib/auth";
import { can, type CurrentUser, type PermissionKey } from "@/lib/access";
import { loadPermissions } from "@/lib/permissions/load";
import { hasLiveZonePost } from "@/lib/zone-staff";
import { readViewAsState } from "@/lib/view-as";

// Resolving who is asking. The rules about what they may then do live in
// access.ts and permissions/, which are pure and tested on their own — this
// file only reads the session and applies them.

export type { CurrentUser } from "@/lib/access";
export {
  accountScope,
  can,
  canAny,
  canCreateAccount,
  canWriteScore,
  isAdmin,
  isBft,
  isCompetitor,
  isStudio,
  teamScope,
} from "@/lib/access";

/**
 * Where an account type belongs when it lands somewhere it may not be.
 *
 * A refusal has to land somewhere the refused person can actually stand, or a
 * studio and the console bounce between each other forever.
 */
export function homeFor(role: Role): string {
  if (role === "studio") return "/studio";
  if (role === "competitor") return "/me";
  if (role === "admin") return "/";
  return "/home";
}

/**
 * The same, resolved for a PERSON rather than an account type: somebody
 * working a zone of a running competition belongs on their judge sheet,
 * whatever type the account is. BFT MENA Partial staff whose roles open the
 * dashboard land on it; everyone else without a home of their own on /home.
 */
export async function homeForUser(user: CurrentUser): Promise<string> {
  try {
    if (can(user, "judgeSheet.view") && (await hasLiveZonePost(user.id))) return "/my-wave";
  } catch {
    // A refused route must never turn into a 500 because the grant lookup
    // hiccuped — the role's ordinary home is always a safe answer.
  }
  if (user.role === "staff" && can(user, "dashboard.view")) return "/";
  return homeFor(user.role);
}

// React cache lasts for this server render only, never across users or requests.
// Layouts and their page share the same permission/preview resolution.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  // A token can outlive a change of status by up to its refresh window, so the
  // check is repeated here rather than trusted from sign-in time.
  if (session.user.status !== "active") return null;

  // The idle deadline (session-deadline.ts) is kept here, on every request,
  // so a session past it stops resolving even if its cookie is still sent.
  if (session.user.expiresAt && Date.now() > session.user.expiresAt) return null;

  // An admin holding a preview cookie sees the whole app through another
  // account's eyes — same menus, same screens, same refusals. The swap only
  // ever happens for an admin session, and writes are refused outright while
  // it lives (proxy.ts), so the audit trail never learns to lie. The marker
  // travels on the returned user so screens can say whose eyes those are.
  if (session.user.role === "admin") {
    const viewed = await readViewAsState();
    if (viewed && viewed.userId !== session.user.id) {
      return {
        id: viewed.userId,
        email: viewed.email,
        name: viewed.name,
        role: viewed.role,
        studioId: viewed.studioId,
        locale: viewed.locale,
        permissions: await loadPermissions(viewed.userId, viewed.role),
        viewAs: { byAdminId: session.user.id },
      };
    }
  }

  // Permissions are read fresh from the account's roles and overrides on every
  // request, so a role change applies on the next click — no sign-out needed.
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? null,
    role: session.user.role,
    studioId: session.user.studioId,
    locale: session.user.locale,
    permissions: await loadPermissions(session.user.id, session.user.role),
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Gate by ACCOUNT TYPE. Only for screens whose data is inherently one type's —
 * the studio area, an athlete's own page. Everything else gates by permission.
 */
export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(await homeForUser(user));
  return user;
}

/**
 * Gate a SCREEN by a catalog permission key (permissions/catalog.ts).
 * BFT MENA Full passes everything; everyone else passes when their resolved
 * permission list carries the key. A refusal lands where that person belongs.
 */
export async function requireAccess(permission: PermissionKey): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, permission)) redirect(await homeForUser(user));
  return user;
}

/**
 * Gate a COMPETITION CONSOLE screen (/series/[series]/…): the key, and the
 * console itself — BFT MENA and organisers, never a studio or an athlete,
 * who have areas of their own scoped to their own teams. The competition
 * layout turns them away as well, but a layout is not a guard: a page segment
 * can be rendered on its own during navigation, so every console screen
 * repeats the check rather than trusting the layout above it.
 */
export async function requireConsoleAccess(permission: PermissionKey): Promise<CurrentUser> {
  const user = await requireAccess(permission);
  if (user.role === "studio" || user.role === "competitor") redirect(await homeForUser(user));
  return user;
}

/** Same as requireAccess, passing when the user holds any one of the keys. */
export async function requireAnyAccess(permissions: PermissionKey[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!permissions.some((permission) => can(user, permission))) redirect(await homeForUser(user));
  return user;
}

export type Forbidden = { ok: false; error: "FORBIDDEN" | "UNAUTHENTICATED" };

/**
 * Gate a SERVER ACTION by a catalog key. Returns the user, or a result the
 * action hands straight back — an action must never redirect a fetch.
 */
export async function assertAccess(
  permission: PermissionKey
): Promise<{ user: CurrentUser; denied: null } | { user: null; denied: Forbidden }> {
  const user = await getCurrentUser();
  if (!user) return { user: null, denied: { ok: false, error: "UNAUTHENTICATED" } };
  if (!can(user, permission)) return { user: null, denied: { ok: false, error: "FORBIDDEN" } };
  return { user, denied: null };
}
