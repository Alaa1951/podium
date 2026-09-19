import "server-only";

import type { CurrentUser } from "@/lib/access";
import { PERMISSION_TREE, policyOf } from "@/lib/permissions/catalog";
import { canAssignRole, canManageTarget } from "@/lib/permissions/grant-policy";
import { loadAccessInputs } from "@/lib/permissions/load";
import {
  explainPermissions,
  parseOverrides,
  resolveEffectivePermissions,
  withinCeiling,
} from "@/lib/permissions/resolve";
import { DEFAULT_ROLE_FOR } from "@/lib/permissions/system-roles";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// Everything the Access panel shows for one person, decided on the server.
//
// The panel computes no policy of its own: which roles the viewer may give or
// take, which rows they may grant or lock, and why the rest are locked all come
// from the same grant-policy functions the actions enforce.
// ─────────────────────────────────────────────────────────────────────────────

export type OverrideState = "inherit" | "grant" | "lock";

export type RowSource =
  | { kind: "general" }
  | { kind: "role"; roles: string[] }
  | { kind: "grant" }
  | { kind: "lock" }
  | { kind: "ceiling" }
  | { kind: "none" };

/** Why a control on a row is unavailable to this viewer. */
export type RowLock = "FULL_ADMIN_ONLY" | "ABOVE_ACCOUNT_TYPE" | "NOT_HELD" | "ALWAYS_ON" | null;

export type AccessRow = {
  key: string;
  label: string;
  labelAr: string;
  effective: boolean;
  source: RowSource;
  state: OverrideState;
  /** Why "Grant" is unavailable, or null when it is available. */
  grantLock: RowLock;
  /** Why "Lock" is unavailable, or null when it is available. */
  lockLock: RowLock;
};

export type AccessPanelData = {
  userId: string;
  accountType: string;
  loadedAt: string;
  isFullAdmin: boolean;
  /** The role in force while none is given, if the account type has one. */
  defaultRole: { name: string; nameAr: string | null } | null;
  held: { id: string; name: string; nameAr: string | null; canRemove: boolean }[];
  assignable: { id: string; name: string; nameAr: string | null; description: string | null }[];
  canManage: boolean;
  canOverride: boolean;
  modules: {
    key: string;
    label: string;
    labelAr: string;
    screens: { key: string; label: string; labelAr: string; rows: AccessRow[] }[];
  }[];
  effectiveCount: number;
  total: number;
};

export async function buildAccessPanel(
  viewer: CurrentUser,
  userId: string
): Promise<AccessPanelData | null> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      studioId: true,
      permissionOverrides: true,
      permissionsUpdatedAt: true,
      accessRoles: {
        select: {
          accessRole: {
            select: { id: true, name: true, nameAr: true, assignableBy: true, permissions: true },
          },
        },
        orderBy: { accessRole: { sortOrder: "asc" } },
      },
    },
  });
  if (!target) return null;

  const [allRoles, inputs] = await Promise.all([
    prisma.accessRole.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        nameAr: true,
        description: true,
        assignableBy: true,
        permissions: true,
      },
    }),
    loadAccessInputs(target.id, target.role),
  ]);

  const actor = { id: viewer.id, role: viewer.role, studioId: viewer.studioId, permissions: viewer.permissions };
  const readOnly = !!viewer.viewAs;
  const canManage = !readOnly && canManageTarget(actor, target).allowed;
  const heldIds = new Set(target.accessRoles.map((link) => link.accessRole.id));

  const held = target.accessRoles.map(({ accessRole }) => ({
    id: accessRole.id,
    name: accessRole.name,
    nameAr: accessRole.nameAr,
    canRemove: canManage && canAssignRole(actor, target, accessRole).allowed,
  }));
  const assignable = canManage
    ? allRoles
        .filter((role) => !heldIds.has(role.id) && canAssignRole(actor, target, role).allowed)
        .map(({ id, name, nameAr, description }) => ({ id, name, nameAr, description }))
    : [];

  const defaultKey = DEFAULT_ROLE_FOR[target.role];
  const defaultRow = defaultKey ? allRoles.find((role) => role.key === defaultKey) : undefined;

  const overrides = parseOverrides(target.permissionOverrides);
  const explained = explainPermissions(inputs);
  const effective = new Set(resolveEffectivePermissions(inputs));
  const isFullAdmin = target.role === "admin";
  const canOverride =
    canManage && !isFullAdmin && (viewer.role === "admin" || viewer.permissions.includes("users.overrides"));
  const actorHolds = (key: string) => viewer.role === "admin" || viewer.permissions.includes(key);

  const modules = PERMISSION_TREE.map((module) => ({
    key: module.key,
    label: module.label,
    labelAr: module.labelAr,
    screens: module.screens.map((screen) => ({
      key: screen.key,
      label: screen.label,
      labelAr: screen.labelAr,
      rows: screen.permissions.map((entry): AccessRow => {
        const policy = policyOf(entry.key);
        const state: OverrideState = overrides.deny.includes(entry.key)
          ? "lock"
          : overrides.grant.includes(entry.key)
            ? "grant"
            : "inherit";
        const notHeld = !actorHolds(entry.key);
        const grantLock: RowLock =
          policy === "fullAdminOnly"
            ? "FULL_ADMIN_ONLY"
            : policy === "general"
              ? "ALWAYS_ON"
              : !withinCeiling(target.role, entry.key)
                ? "ABOVE_ACCOUNT_TYPE"
                : notHeld
                  ? "NOT_HELD"
                  : null;
        const lockLock: RowLock =
          policy === "fullAdminOnly" ? "FULL_ADMIN_ONLY" : notHeld ? "NOT_HELD" : null;
        return {
          key: entry.key,
          label: entry.label,
          labelAr: entry.labelAr,
          effective: isFullAdmin || effective.has(entry.key),
          source: explained.get(entry.key) ?? { kind: "none" },
          state,
          grantLock,
          lockLock,
        };
      }),
    })),
  }));

  const total = modules.reduce(
    (sum, module) => sum + module.screens.reduce((n, screen) => n + screen.rows.length, 0),
    0
  );
  const effectiveCount = modules.reduce(
    (sum, module) =>
      sum + module.screens.reduce((n, screen) => n + screen.rows.filter((row) => row.effective).length, 0),
    0
  );

  return {
    userId: target.id,
    accountType: target.role,
    loadedAt: target.permissionsUpdatedAt?.toISOString() ?? "",
    isFullAdmin,
    defaultRole:
      !held.length && defaultRow ? { name: defaultRow.name, nameAr: defaultRow.nameAr } : null,
    held,
    assignable,
    canManage,
    canOverride,
    modules,
    effectiveCount,
    total,
  };
}
