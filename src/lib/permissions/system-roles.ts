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

/**
 * The desk work of the day, held by every shipped STAFF role except Judge and
 * Coach: entrance check-in, warm-up check-in, and changing a team's category
 * or level at the athlete's request. `checkIn.view` opens the two screens.
 * Whose teams each of them reaches is still their account type's scope
 * (access.ts › teamScope): a gym's own, never another gym's.
 */
const DESK_WORK: PermissionKey[] = [
  "registrations.attendance",
  "registrations.bracket",
  "checkIn.view",
  "checkIn.warmup",
];

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: "bft-partial",
    name: "BFT MENA Partial",
    nameAr: "بي إف تي مينا - صلاحية جزئية",
    description:
      "BFT MENA staff with chosen screens only. Starts as view-only everywhere, plus the desk work of the day: entrance and warm-up check-in, and changing a team's category or level at the athlete's request.",
    assignableBy: "bft",
    accountTypes: ["staff"],
    sortOrder: 10,
    permissions: [...new Set([...VIEW_ALL, ...DESK_WORK])],
  },
  {
    key: "gym-studio",
    name: "Gym / Studio",
    nameAr: "الجيم / الاستوديو",
    description:
      "Runs its own gym: approves its people, registers and pairs its athletes, places its teams in waves, checks its own teams in (entrance and warm-up) and changes their category or level at the athlete's request. No score entry.",
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
      "registrations.partners",
      "registrations.export",
      ...DESK_WORK,
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
      "Runs the floor of every competition: builds the waves and places teams, starts the day, starts/ends/resets waves on Wave control, puts judges on zones and picks zone leaders, runs entrance and warm-up check-in, and changes a team's category or level at the athlete's request. Sees the entry list, T-shirt counts, scores and results. Does not change who is on a team, enter scores or change settings.",
    // BFT MENA only: the role runs the floor of EVERY competition (Wave
    // control, zone teams), so a gym handing it out would hand one of its own
    // people control of rival gyms' waves and judges. For the same reason it
    // is never meant for a gym's own account — and the floor actions refuse
    // a gym account whatever it holds (isFloorAccount, access.ts).
    assignableBy: "bft",
    accountTypes: ["organiser", "staff"],
    sortOrder: 30,
    permissions: [
      "overview.view",
      "competitionStudios.view",
      "registrations.view",
      "registrations.export",
      "registrations.partners",
      ...DESK_WORK,
      "waves.view",
      "waves.placeTeams",
      "waves.edit",
      "waveControl.view",
      "waveControl.control",
      "marshalling.view",
      "shirts.view",
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
    description:
      "Scores on the floor from the judge sheet: the team on their station in their zone. Placed as a zone LEADER, scores any station of that zone, places its judges on stations and starts the next wave.",
    assignableBy: "bft_studio",
    accountTypes: ["organiser", "studio", "staff"],
    sortOrder: 40,
    permissions: ["judgeSheet.view", "scores.enter"],
  },
  {
    key: "volunteer",
    name: "Volunteer",
    nameAr: "متطوع",
    description:
      "Moves athletes on the floor: sees Marshalling (where each wave is, where it goes next, who to call up), the wave schedule and the live board; runs entrance and warm-up check-in, and changes a team's category or level at the athlete's request.",
    assignableBy: "bft",
    accountTypes: ["organiser"],
    sortOrder: 50,
    permissions: ["waves.view", "marshalling.view", ...DESK_WORK],
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
    permissions: [
      "athleteHome.view",
      "athleteHome.editTeam",
      "partner.view",
      "partner.edit",
      "partner.browse",
      "partner.request",
    ],
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
