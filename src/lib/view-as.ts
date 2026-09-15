import "server-only";

import { cookies } from "next/headers";

import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  signViewAs,
  verifyViewAs,
  VIEW_AS_COOKIE,
  VIEW_AS_MAX_AGE,
} from "@/lib/view-as-token";

/**
 * VIEWING THE APP THROUGH SOMEONE ELSE'S EYES.
 *
 * An admin needs to see what a member sees, what a studio sees, what a wave
 * scorer sees — the menus, the screens, the refusals — without keeping a
 * private login for every one of those accounts. So an admin may hold a signed
 * preview cookie naming one account; while it lives, the session resolves to
 * that account's identity and permissions, everywhere.
 *
 * The guard rails, in order of how much they matter:
 *
 * 1. The preview only ever applies to a session that is ALREADY an admin —
 *    `getCurrentUser` checks that before it reads the cookie at all. Sign out
 *    and a leftover cookie is inert.
 * 2. The preview is read-only. `proxy.ts` refuses every Server Action POST
 *    while the cookie is present, so nothing can be changed under somebody
 *    else's name — the audit trail never learns to lie. Leaving is a GET
 *    (/api/view-as/exit), which is why it still works.
 * 3. The cookie is signed and expires on its own within the hour. Anything it
 *    does not like reads as "no preview".
 *
 * The real admin identity never changes — only the lens.
 */

const VIEW_AS_SECRET =
  process.env.OTP_SECRET || process.env.NEXTAUTH_SECRET || "";

export type ViewAsState = {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  studioId: string | null;
  locale: string;
  accessRoleId: string | null;
};

/**
 * The previewed account, if the requester is holding a live preview cookie.
 * Returns null for every ordinary case: no cookie, a stale or forged one. The
 * session layer (which knows who is actually asking) refuses to apply this to
 * anybody but an admin; the account itself also has to still exist and be
 * active — a preview of a since-disabled account ends with the account.
 */
export async function readViewAsState(): Promise<ViewAsState | null> {
  const store = await cookies();
  const token = store.get(VIEW_AS_COOKIE)?.value;
  if (!token) return null;

  const userId = verifyViewAs(token, VIEW_AS_SECRET);
  if (!userId) return null;

  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      studioId: true,
      locale: true,
      accessRoleId: true,
      status: true,
      archivedAt: true,
    },
  });
  if (!account || account.status !== "active" || account.archivedAt) return null;

  return {
    userId: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    studioId: account.studioId,
    locale: account.locale,
    accessRoleId: account.accessRoleId,
  };
}

/**
 * Cut a fresh preview cookie for one account. Only ever called from the
 * admin-only server action — this helper trusts its caller about WHO asked;
 * the signature and expiry are what keep the cookie honest afterwards.
 */
export async function writeViewAsCookie(userId: string) {
  const expiresAt = Date.now() + VIEW_AS_MAX_AGE * 1_000;
  const store = await cookies();
  store.set(VIEW_AS_COOKIE, signViewAs(userId, expiresAt, VIEW_AS_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VIEW_AS_MAX_AGE,
  });
}

/** End the preview. The next request sees the admin again. */
export async function clearViewAsCookie() {
  const store = await cookies();
  store.delete(VIEW_AS_COOKIE);
}
