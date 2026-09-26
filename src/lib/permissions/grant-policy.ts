import { isPermissionKey, normalizeStoredPermissions, policyOf } from "@/lib/permissions/catalog";
import type { AccountType, RoleAssigner } from "@/lib/permissions/system-roles";

// ─────────────────────────────────────────────────────────────────────────────
// WHO MAY GIVE WHAT TO WHOM — the anti-escalation rules.
//
// 1. You can only hand out what you hold. Editing a role's permissions, or
//    granting/locking a single permission for a person, touches only keys the
//    actor holds themselves. (Removing counts too: you cannot strip a power you
//    do not have and cannot judge.)
// 2. Nobody changes their own access — roles or overrides.
// 3. BFT MENA Full access is exempt from rule 1, and only rule 1.
// 4. A studio hands out only roles flagged `bft_studio`, only to people in its
//    own studio, and such a role can never carry a BFT-only permission.
// 5. A Full-admin-only permission never goes into a role or a grant.
//
// Pure. The server actions load the rows and call these; the editors call the
// same functions to decide which rows to lock and why.
// ─────────────────────────────────────────────────────────────────────────────

export type Actor = {
  id: string;
  role: AccountType;
  studioId: string | null;
  permissions: string[];
};

export type TargetAccount = {
  id: string;
  role: AccountType;
  studioId: string | null;
  /**
   * The target's effective permissions. Needed when a BFT MENA Partial actor
   * manages another Partial account (see canManageTarget); load them with
   * targetWithPermissions (permissions/load.ts).
   */
  permissions?: string[];
};

export type RoleForGrant = {
  assignableBy: RoleAssigner;
  permissions: unknown;
  /** The account types the role is meant for (AccessRole.accountTypes). Empty or absent: any. */
  accountTypes?: unknown;
};

const holds = (actor: Actor, key: string) =>
  actor.role === "admin" || actor.permissions.includes("*") || actor.permissions.includes(key);

/** Why a single permission row is locked for this editor, or null if editable. */
export type LockReason =
  | "ALWAYS_ON"
  | "FULL_ADMIN_ONLY"
  | "BFT_ONLY_ROLE" // a role studios can hand out may not carry it
  | "NOT_HELD";

export function roleRowLock(
  actor: Actor,
  key: string,
  role: { assignableBy: RoleAssigner }
): LockReason | null {
  const policy = policyOf(key);
  if (policy === "general") return "ALWAYS_ON";
  if (policy === "fullAdminOnly" || !policy) return "FULL_ADMIN_ONLY";
  if (policy === "bftOnly" && role.assignableBy === "bft_studio") return "BFT_ONLY_ROLE";
  if (!holds(actor, key)) return "NOT_HELD";
  return null;
}

export type Refusal = { allowed: false; reason: string; keys?: string[] };
export type Decision = { allowed: true } | Refusal;

/** Validate a role's new permission list against its assigner flag. */
export function validateRoleContents(
  permissions: string[],
  assignableBy: RoleAssigner
): Decision {
  const unknown = permissions.filter((key) => !isPermissionKey(key));
  if (unknown.length) return { allowed: false, reason: "UNKNOWN_PERMISSION", keys: unknown };
  const never = permissions.filter((key) => {
    const policy = policyOf(key);
    return policy === "general" || policy === "fullAdminOnly";
  });
  if (never.length) return { allowed: false, reason: "NOT_STORABLE", keys: never };
  if (assignableBy === "bft_studio") {
    const bftOnly = permissions.filter((key) => policyOf(key) === "bftOnly");
    if (bftOnly.length) return { allowed: false, reason: "BFT_ONLY_IN_STUDIO_ROLE", keys: bftOnly };
  }
  return { allowed: true };
}

/**
 * Editing a role: the actor must hold roles.edit and every key that changes.
 * Keys the actor does not hold are carried over untouched by `mergeScoped`.
 */
export function canEditRole(actor: Actor, before: unknown, after: string[]): Decision {
  if (!holds(actor, "roles.edit")) return { allowed: false, reason: "FORBIDDEN" };
  const was = new Set<string>(normalizeStoredPermissions(before));
  const now = new Set<string>(after);
  const changed = [...new Set([...was, ...now])].filter((key) => was.has(key) !== now.has(key));
  const notHeld = changed.filter((key) => !holds(actor, key));
  if (notHeld.length) return { allowed: false, reason: "NOT_HELD", keys: notHeld };
  return { allowed: true };
}

/**
 * Whether the actor may change who this person is at all (roles, overrides,
 * status, name and email, reset links). Never yourself; never BFT MENA Full
 * unless you are it; a studio only within its own studio and never over BFT
 * MENA staff.
 *
 * BFT MENA Partial over another Partial account: only when the actor holds
 * every permission that account holds. Otherwise a Partial account could
 * change a stronger colleague's email, send the reset link there, and sign in
 * as them — rule 1 ("only what you hold") walked around through the account.
 * Without the target's permissions the answer is no: fail closed.
 */
export function canManageTarget(actor: Actor, target: TargetAccount): Decision {
  if (actor.id === target.id) return { allowed: false, reason: "CANNOT_CHANGE_OWN_ACCESS" };
  if (actor.role === "admin") return { allowed: true };
  if (target.role === "admin") return { allowed: false, reason: "FORBIDDEN" };
  if (actor.role === "staff") {
    if (target.role !== "staff") return { allowed: true };
    if (!target.permissions) return { allowed: false, reason: "FORBIDDEN" };
    const notHeld = target.permissions.filter((key) => !holds(actor, key));
    if (notHeld.length) return { allowed: false, reason: "NOT_HELD", keys: notHeld };
    return { allowed: true };
  }
  if (actor.role === "studio") {
    if (!actor.studioId || target.studioId !== actor.studioId) {
      return { allowed: false, reason: "FORBIDDEN" };
    }
    if (target.role === "staff") return { allowed: false, reason: "FORBIDDEN" };
    return { allowed: true };
  }
  return { allowed: false, reason: "FORBIDDEN" };
}

/** Giving a role to (or taking it from) a person. */
export function canAssignRole(actor: Actor, target: TargetAccount, role: RoleForGrant): Decision {
  if (!holds(actor, "users.assignRoles")) return { allowed: false, reason: "FORBIDDEN" };
  const manage = canManageTarget(actor, target);
  if (!manage.allowed) return manage;
  if (actor.role === "admin") return { allowed: true };

  if (actor.role === "studio") {
    // A studio's trust comes from the flag BFT MENA set on the role, not from
    // holding its contents — a studio does not judge, yet appoints judges.
    if (role.assignableBy !== "bft_studio") return { allowed: false, reason: "ROLE_NOT_ASSIGNABLE" };
    return { allowed: true };
  }

  // BFT MENA Partial: only roles made entirely of permissions they hold.
  const notHeld = normalizeStoredPermissions(role.permissions).filter((key) => !holds(actor, key));
  if (notHeld.length) return { allowed: false, reason: "NOT_HELD", keys: notHeld };
  return { allowed: true };
}

/** Whether a role is meant for this account type. A role naming none fits all. */
export function roleFitsAccount(role: Pick<RoleForGrant, "accountTypes">, accountType: AccountType): boolean {
  const types = Array.isArray(role.accountTypes)
    ? role.accountTypes.filter((type): type is string => typeof type === "string")
    : [];
  return types.length === 0 || types.includes(accountType);
}

/**
 * GIVING a role (not taking it away): everything canAssignRole asks, and the
 * role must be meant for the person's account type — the Judge role for an
 * organiser account, never for an athlete's. BFT MENA Full access decides for
 * itself. Taking a role away stays possible whatever it is held on, so a
 * wrongly given role can always be removed.
 */
export function canGiveRole(actor: Actor, target: TargetAccount, role: RoleForGrant): Decision {
  const decision = canAssignRole(actor, target, role);
  if (!decision.allowed) return decision;
  if (actor.role !== "admin" && !roleFitsAccount(role, target.role)) {
    return { allowed: false, reason: "ROLE_NOT_FOR_ACCOUNT_TYPE" };
  }
  return { allowed: true };
}

/** Changing a person's Grant / Lock overrides. */
export function canChangeOverrides(
  actor: Actor,
  target: TargetAccount,
  before: { grant: string[]; deny: string[] },
  after: { grant: string[]; deny: string[] }
): Decision {
  if (!holds(actor, "users.overrides")) return { allowed: false, reason: "FORBIDDEN" };
  const manage = canManageTarget(actor, target);
  if (!manage.allowed) return manage;

  const all = [...after.grant, ...after.deny];
  const unknown = all.filter((key) => !isPermissionKey(key));
  if (unknown.length) return { allowed: false, reason: "UNKNOWN_PERMISSION", keys: unknown };
  const never = after.grant.filter((key) => {
    const policy = policyOf(key);
    return policy === "general" || policy === "fullAdminOnly";
  });
  if (never.length) return { allowed: false, reason: "NOT_STORABLE", keys: never };
  if (actor.role === "admin") return { allowed: true };

  const diff = (a: string[], b: string[]) => {
    const sa = new Set(a);
    const sb = new Set(b);
    return [...new Set([...a, ...b])].filter((key) => sa.has(key) !== sb.has(key));
  };
  const changed = [...new Set([...diff(before.grant, after.grant), ...diff(before.deny, after.deny)])];
  const notHeld = changed.filter((key) => !holds(actor, key));
  if (notHeld.length) return { allowed: false, reason: "NOT_HELD", keys: notHeld };
  return { allowed: true };
}

/**
 * Save only what the editor could change: keys the actor may not touch keep
 * their stored state whatever the client sent (n8n's scoped merge).
 *   next = (stored − editable) ∪ (submitted ∩ editable)
 */
export function mergeScoped(stored: string[], submitted: string[], editable: (key: string) => boolean): string[] {
  const kept = stored.filter((key) => !editable(key));
  const changed = submitted.filter((key) => editable(key));
  return [...new Set([...kept, ...changed])];
}
