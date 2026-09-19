// Relative imports with extensions: the seed script loads this file with plain
// Node (type stripping), which knows nothing of the "@/" alias.
import type { Role } from "../../generated/prisma/enums.ts";
import { ALL_PERMISSION_KEYS, policyOf, type PermissionKey } from "./catalog.ts";

// ─────────────────────────────────────────────────────────────────────────────
// THE ROLES PODIUM SHIPS WITH.
//
// These are only the STARTING point. Each one is seeded as a row
// (AccessRole, isSystem) and from then on BFT MENA edits it on the Roles screen
// like any other — the row wins. The definitions here are used to create a
// missing row, and as a fallback if a system row is somehow absent, so a fresh
// database still behaves sensibly.
// ─────────────────────────────────────────────────────────────────────────────

export type AccountType = Role;
export type RoleAssigner = "bft" | "bft_studio";

export type SystemRoleDef = {
  key: string;
  name: string;
  nameAr: string;
  description: string;
  assignableBy: RoleAssigner;
  accountTypes: AccountType[];
  sortOrder: number;
  permissions: PermissionKey[];
};

/** Every storable `view` key — the starting point for BFT MENA Partial access. */
const VIEW_ALL: PermissionKey[] = ALL_PERMISSION_KEYS.filter((key) => {
  const policy = policyOf(key);
  if (policy !== "role" && policy !== "bftOnly") return false;
  // Personal screens belong to athletes and judges, not to HQ staff.
  return key.endsWith(".view") && !["athleteHome.view", "partner.view", "judgeSheet.view"].includes(key);
});

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: "bft-partial",
    name: "BFT MENA Partial",
    nameAr: "بي إف تي مينا - صلاحية جزئية",
    description: "BFT MENA staff with chosen screens only. Starts as view-only everywhere.",
    assignableBy: "bft",
    accountTypes: ["staff"],
    sortOrder: 10,
    permissions: VIEW_ALL,
  },
  {
    key: "gym-studio",
    name: "Gym / Studio",
    nameAr: "الجيم / الاستوديو",
    description:
      "Runs its own gym: approves its people, registers and pairs its athletes, places its teams in waves. No score entry.",
    assignableBy: "bft",
    accountTypes: ["studio"],
    sortOrder: 20,
    permissions: [
      "users.view",
      "users.invite",
      "users.disable",
      "users.delete",
      "users.assignRoles",
      "approvals.view",
      "approvals.decide",
      "announcements.send",
      "registrations.view",
      "registrations.create",
      "registrations.edit",
      "registrations.archive",
      "registrations.pair",
      "registrations.export",
      "waves.view",
      "waves.placeTeams",
      "scores.view",
      "results.view",
    ],
  },
  {
    key: "organiser",
    name: "Organiser",
    nameAr: "منظم",
    description:
      "Sees everything in a competition and runs the floor: waves, wave control, zone teams. Does not edit teams or enter scores.",
    assignableBy: "bft_studio",
    accountTypes: ["organiser", "studio", "staff"],
    sortOrder: 30,
    permissions: [
      "overview.view",
      "competitionStudios.view",
      "registrations.view",
      "registrations.export",
      "waves.view",
      "waves.placeTeams",
      "waves.edit",
      "waveControl.view",
      "waveControl.control",
      "zoneStaff.view",
      "zoneStaff.assign",
      "scores.view",
      "results.view",
      "settings.view",
    ],
  },
  {
    key: "judge",
    name: "Judge",
    nameAr: "حكم",
    description: "Enters scores for the zone and station they are placed on. Nothing else.",
    assignableBy: "bft_studio",
    accountTypes: ["organiser", "studio", "staff"],
    sortOrder: 40,
    permissions: ["judgeSheet.view", "scores.enter"],
  },
  {
    key: "volunteer",
    name: "Volunteer",
    nameAr: "متطوع",
    description: "Sees the wave schedule and the live board.",
    assignableBy: "bft",
    accountTypes: ["organiser"],
    sortOrder: 50,
    permissions: ["waves.view"],
  },
  {
    key: "coach",
    name: "Coach",
    nameAr: "مدرب",
    description: "Sees the wave schedule, results and the live board.",
    assignableBy: "bft",
    accountTypes: ["organiser"],
    sortOrder: 60,
    permissions: ["waves.view", "results.view"],
  },
  {
    key: "athlete",
    name: "Athlete",
    nameAr: "رياضي",
    description: "Their own profile, partner, team and wave.",
    assignableBy: "bft_studio",
    accountTypes: ["competitor"],
    sortOrder: 70,
    permissions: ["athleteHome.view", "athleteHome.editTeam", "partner.view", "partner.edit"],
  },
];

const BY_KEY = new Map(SYSTEM_ROLES.map((role) => [role.key, role]));

export function systemRole(key: string): SystemRoleDef | undefined {
  return BY_KEY.get(key);
}

/**
 * The role an account falls back to while it holds none. Holding any role
 * replaces the default entirely — exactly how a single access role used to
 * replace a role's defaults.
 */
export const DEFAULT_ROLE_FOR: Partial<Record<AccountType, string>> = {
  staff: "bft-partial",
  studio: "gym-studio",
  competitor: "athlete",
};
