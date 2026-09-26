import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import type { PermissionKey } from "@/lib/permissions/catalog";

// ─────────────────────────────────────────────────────────────────────────────
// The access rules, and nothing else.
//
// Deliberately free of imports that touch the database, the session or the
// network: these are pure decisions about who may see and do what, so they can
// be read in one sitting, tested exhaustively (access.test.ts), and reviewed as
// a security surface on their own. `session.ts` is the thin layer that resolves
// the current user and applies them.
//
// Two separate questions, answered separately:
//   • WHAT may this person do?  → their permissions (permissions/*), checked
//     with can(). Roles are data, edited on the Roles screen.
//   • WHOSE data may they touch? → their account type (`role`), expressed as
//     the Prisma filters below. BFT MENA sees everything, a studio its own,
//     an athlete their own team.
//
// Nothing here is a secret — knowing the rules does not let anyone past them,
// because every one of them is enforced on the server against the database.
// ─────────────────────────────────────────────────────────────────────────────

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  /** The ACCOUNT TYPE — whose data this person can reach. */
  role: Role;
  studioId: string | null;
  locale: string;
  /** The permission keys this account resolves to. BFT MENA Full carries ["*"]. */
  permissions: string[];
  /**
   * Set when an admin is looking through this account's eyes — a read-only
   * preview (see lib/view-as.ts). Its presence is also how screens say so.
   */
  viewAs?: { byAdminId: string };
};

export {
  ALL_PERMISSION_KEYS,
  GENERAL_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_TREE,
  type PermissionKey,
} from "@/lib/permissions/catalog";

/**
 * THE one permission decision. BFT MENA Full access passes everything; everyone
 * else passes when their resolved permission list carries the key.
 */
export function can(user: Pick<CurrentUser, "role" | "permissions">, permission: PermissionKey): boolean {
  if (user.role === "admin") return true;
  return user.permissions.includes(permission);
}

/** True when the user holds at least one of the keys. */
export function canAny(
  user: Pick<CurrentUser, "role" | "permissions">,
  permissions: PermissionKey[]
): boolean {
  return permissions.some((permission) => can(user, permission));
}

/**
 * The sentinel a scoped query falls back to when an account has no studio.
 * It is a value that matches no row, so the failure mode of a misconfigured
 * studio account is "sees nothing" rather than "sees everything".
 */
export const NO_MATCH = "__none__";

export const isAdmin = (user: Pick<CurrentUser, "role">) => user.role === "admin";
/** BFT MENA, Full or Partial access. */
export const isBft = (user: Pick<CurrentUser, "role">) =>
  user.role === "admin" || user.role === "staff";
export const isStudio = (user: Pick<CurrentUser, "role">) => user.role === "studio";
export const isCompetitor = (user: Pick<CurrentUser, "role">) => user.role === "competitor";

/**
 * The team rows this user is allowed to see, as a Prisma filter.
 *
 * - BFT MENA and event organisers see every team (what they may DO with them
 *   is a question for their permissions).
 * - A studio sees only the teams it registered.
 * - An athlete sees only the team they compete on — never their studio's
 *   other teams, which are other athletes' business.
 */
export function teamScope(user: Pick<CurrentUser, "id" | "role" | "studioId">): Prisma.TeamWhereInput {
  if (user.role === "admin" || user.role === "staff" || user.role === "organiser") return {};
  if (user.role === "studio") return { studioId: user.studioId ?? NO_MATCH };
  return { competitors: { some: { userId: user.id } } };
}

/** The account rows this user may list and manage. */
export function accountScope(user: Pick<CurrentUser, "id" | "role" | "studioId">): Prisma.UserWhereInput {
  if (user.role === "admin" || user.role === "staff") return {};
  if (user.role === "studio") return { studioId: user.studioId ?? NO_MATCH };
  return { id: user.id };
}

export type ScoreWriteDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "FORBIDDEN" | "SCORE_ENTRY_CLOSED" | "WAVE_CLOCK_ENDED";
    };

/**
 * THE WHOLE RULE for writing a score from the console, in one place.
 *
 * The console is BFT MENA's: Full access, or Partial access holding
 * `scores.enter`. Judges and zone leaders hold `scores.enter` too — it is what
 * lets them score on the floor — but they write one zone of one team from
 * their own sheet (saveZoneScore, zone-score-rules.ts), where their zone and
 * station are checked. Letting the key alone through here handed every judge
 * the whole field, every zone, from a crafted request. Studios, organisers and
 * athletes never write from the console.
 *
 * Once a wave's clock has run out its scores are history, and correcting them
 * is BFT MENA Full access only — a permission nobody can be given.
 */
export function canWriteScore(
  user: Pick<CurrentUser, "role" | "permissions">,
  series: { scoreEntryClosesAt: Date | null },
  now: Date,
  wave: { ended: boolean } = { ended: false }
): ScoreWriteDecision {
  if (user.role === "admin") return { allowed: true };
  if (wave.ended) return { allowed: false, reason: "WAVE_CLOCK_ENDED" };
  if (series.scoreEntryClosesAt && now >= series.scoreEntryClosesAt) {
    return { allowed: false, reason: "SCORE_ENTRY_CLOSED" };
  }
  if (user.role !== "staff") return { allowed: false, reason: "FORBIDDEN" };
  if (!can(user, "scores.enter")) return { allowed: false, reason: "FORBIDDEN" };
  return { allowed: true };
}

/**
 * WHO MAY PRESS THE WAVE BUTTONS.
 *
 *   waveControl.control  (the supervisor: Organiser role, BFT MENA)
 *                        Start, End now and Reset.
 *   Zone leader          Start only, for a competition they lead a zone of.
 *                        Sending the next wave onto the floor is a floor
 *                        call; stopping or rewinding one is the supervisor's.
 *
 * `leadsAZone` is whether this person leads any zone of the wave's
 * competition — the action reads it from ZoneStaff.
 */
export function canControlWave(
  user: Pick<CurrentUser, "role" | "permissions">,
  action: "start" | "finish" | "reset",
  leadsAZone: boolean
): boolean {
  if (can(user, "waveControl.control")) return true;
  return action === "start" && leadsAZone;
}

/**
 * Who a given account may create, and under which studio. BFT MENA Full issues
 * anything; BFT MENA Partial anything but Full access; a studio issues athletes
 * and organisers, always into its own studio whatever was submitted.
 */
export function canCreateAccount(
  actor: Pick<CurrentUser, "role" | "permissions" | "studioId">,
  role: Role,
  requestedStudioId: string | null
):
  | { allowed: true; studioId: string | null }
  | { allowed: false; reason: "FORBIDDEN" | "NO_STUDIO" } {
  if (actor.role === "admin") return { allowed: true, studioId: requestedStudioId };
  if (!can(actor, "users.invite")) return { allowed: false, reason: "FORBIDDEN" };
  if (actor.role === "staff") {
    if (role === "admin") return { allowed: false, reason: "FORBIDDEN" };
    return { allowed: true, studioId: requestedStudioId };
  }
  if (actor.role !== "studio") return { allowed: false, reason: "FORBIDDEN" };
  if (role !== "competitor" && role !== "organiser") return { allowed: false, reason: "FORBIDDEN" };
  if (!actor.studioId) return { allowed: false, reason: "NO_STUDIO" };
  return { allowed: true, studioId: actor.studioId };
}
