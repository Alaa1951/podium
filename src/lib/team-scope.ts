import type { CurrentUser } from "@/lib/access";

/**
 * A studio registering a team can only register it to itself. BFT MENA may
 * choose the studio. The value is resolved on the server either way, so a
 * submitted studioId from a studio account is ignored rather than honoured.
 *
 * Here rather than beside the actions because a `"use server"` module may only
 * export async functions — a plain helper exported from one is a build error,
 * and a build error nobody sees until the page 500s.
 */
export function resolveOwningStudio(user: CurrentUser, requested: string | null) {
  if (user.role === "studio") return user.studioId ?? null;
  return requested || null;
}
