import {
  GENERAL_PERMISSIONS,
  normalizeStoredPermissions,
  PERMISSIONS,
  policyOf,
  type PermissionKey,
} from "@/lib/permissions/catalog";
import type { AccountType } from "@/lib/permissions/system-roles";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT A PERSON MAY DO, WORKED OUT FROM WHAT THEY HOLD.
//
//   effective = (general ∪ roles ∪ grants) ∩ ceiling(account type) − locks
//
// • BFT MENA Full access is `*` and never reaches this arithmetic.
// • An account still waiting for approval gets the general set and nothing
//   else, whatever roles it may already carry.
// • The CEILING is decided by the account type, not by any role: a BFT-only
//   permission never reaches a studio, organiser or athlete account even if
//   somebody puts it in a role they hold, and a Full-admin-only permission
//   never reaches anyone.
// • A LOCK always wins. It is applied last.
//
// Pure: no database, no session. session.ts loads the inputs; this decides.
// ─────────────────────────────────────────────────────────────────────────────

export type PermissionOverrides = { grant: string[]; deny: string[] };

export type HeldRole = { key: string; name: string; permissions: unknown };

export type AccessInputs = {
  accountType: AccountType;
  /** False while a sign-up waits for approval (or was rejected). */
  approved: boolean;
  /** The roles in force: those assigned, or the account type's default. */
  roles: HeldRole[];
  overrides: PermissionOverrides | null;
};

/** Read the JSON column defensively: anything malformed means "no overrides". */
export function parseOverrides(raw: unknown): PermissionOverrides {
  if (!raw || typeof raw !== "object") return { grant: [], deny: [] };
  const value = raw as { grant?: unknown; deny?: unknown };
  const list = (input: unknown) =>
    Array.isArray(input) ? input.filter((key): key is string => typeof key === "string") : [];
  return { grant: list(value.grant), deny: list(value.deny) };
}

/** Whether an account type can ever hold a permission, whatever it is given. */
export function withinCeiling(accountType: AccountType, key: string): boolean {
  if (accountType === "admin") return true;
  switch (policyOf(key)) {
    case "general":
    case "role":
      return true;
    case "bftOnly":
      return accountType === "staff";
    default:
      // fullAdminOnly, or a key the catalog does not know.
      return false;
  }
}

export function resolveEffectivePermissions(input: AccessInputs): string[] {
  if (input.accountType === "admin") return ["*"];
  if (!input.approved) return [...GENERAL_PERMISSIONS];

  const granted = new Set<string>(GENERAL_PERMISSIONS);
  for (const role of input.roles) {
    for (const key of normalizeStoredPermissions(role.permissions)) granted.add(key);
  }
  for (const key of normalizeStoredPermissions(input.overrides?.grant ?? [])) granted.add(key);

  const locked = new Set(input.overrides?.deny ?? []);
  return [...granted].filter((key) => withinCeiling(input.accountType, key) && !locked.has(key));
}

export type PermissionSource =
  | { kind: "general" }
  | { kind: "role"; roles: string[] }
  | { kind: "grant" }
  | { kind: "lock" }
  | { kind: "ceiling" } // given, but above what this account type may hold
  | { kind: "none" };

/**
 * For each permission, why this person has it or not — the "Source" column of
 * the access editor. Mirrors resolveEffectivePermissions exactly.
 */
export function explainPermissions(input: AccessInputs): Map<PermissionKey, PermissionSource> {
  const out = new Map<PermissionKey, PermissionSource>();
  const locked = new Set(input.overrides?.deny ?? []);
  const grants = new Set(normalizeStoredPermissions(input.overrides?.grant ?? []));
  const byRole = new Map<string, string[]>();
  for (const role of input.roles) {
    for (const key of normalizeStoredPermissions(role.permissions)) {
      byRole.set(key, [...(byRole.get(key) ?? []), role.name]);
    }
  }

  for (const entry of PERMISSIONS) {
    const key = entry.key;
    if (input.accountType === "admin") {
      out.set(key, entry.policy === "general" ? { kind: "general" } : { kind: "role", roles: ["BFT MENA Full"] });
      continue;
    }
    if (entry.policy === "general") {
      out.set(key, locked.has(key) ? { kind: "lock" } : { kind: "general" });
      continue;
    }
    if (!input.approved) {
      out.set(key, { kind: "none" });
      continue;
    }
    const roles = byRole.get(key);
    const given = !!roles || grants.has(key);
    if (locked.has(key)) out.set(key, { kind: "lock" });
    else if (given && !withinCeiling(input.accountType, key)) out.set(key, { kind: "ceiling" });
    else if (roles) out.set(key, { kind: "role", roles });
    else if (grants.has(key)) out.set(key, { kind: "grant" });
    else out.set(key, { kind: "none" });
  }
  return out;
}
