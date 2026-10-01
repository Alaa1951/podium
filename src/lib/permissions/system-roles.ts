// Relative imports with extensions: the seed script loads this file with plain
// Node (type stripping), which knows nothing of the "@/" alias.
import type { Role } from "../../generated/prisma/enums.ts";
import type { PermissionKey } from "./catalog.ts";

// ─────────────────────────────────────────────────────────────────────────────
// THE ROLES PODIUM SHIPS WITH.
//
// These are only the STARTING point. Each one is seeded as a row
// (AccessRole, isSystem) and from then on BFT MENA edits it on the Roles screen
// like any other — the row ALWAYS wins. The definitions here are used to
// create a missing row (ensure-system-roles.ts never updates an existing one),
// and as a fallback if a system row is somehow absent.
//
// KEPT IN SYNC WITH THE LIVE ROLES SCREEN, as of 2026-09-30: the permission
// lists below are the live rows' own, so a fresh database, or a recreated row,
// starts as the roles are really used — not thinner. permissions.test.ts pins
// them to a snapshot: a difference from live is a review decision, not drift.
// BFT MENA's own custom roles (e.g. "Limited admin") are theirs and are not
// shipped. The names, descriptions, assigners, account types and order could
// not be read from live here and are unchanged.
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
    // No longer "every view key plus the desks": BFT MENA grew it on the Roles
    // screen into the office's working set — registrations end to end, money,
    // users and roles, settings, score entry — so it is listed as live has it.
    permissions: [
      "announcements.send",
      "approvals.decide",
      "approvals.view",
      "athleteHome.editTeam",
      "athleteHome.view",
      "audit.view",
      "checkIn.view",
      "checkIn.warmup",
      "competitionStudios.edit",
      "competitions.create",
      "competitions.view",
      "dashboard.view",
      "judgeSheet.view",
      "overview.view",
      "partner.browse",
      "partner.edit",
      "partner.request",
      "partner.view",
      "registrations.archive",
      "registrations.attendance",
      "registrations.bracket",
      "registrations.create",
      "registrations.edit",
      "registrations.export",
      "registrations.pair",
      "registrations.partners",
      "registrations.payment",
      "registrations.view",
      "registrations.waitlist",
      "results.publish",
      "results.view",
      "roles.edit",
      "roles.view",
      "scores.enter",
      "scores.view",
      "settings.edit",
      "settings.view",
      "sponsors.edit",
      "studios.create",
      "studios.edit",
      "studios.view",
      "users.assignRoles",
      "users.delete",
      "users.disable",
      "users.edit",
      "users.invite",
      "users.overrides",
      "users.view",
      "waveControl.control",
      "waveControl.view",
      "waves.view",
      "zoneStaff.assign",
      "zoneStaff.view",
    ],
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
    // As live: the floor, plus team edits (create, edit, pair) and the two
    // money keys. Payment and the waiting list are BFT-only keys, so an
    // organiser-TYPE account never holds them whatever this lists (resolve.ts
    // › withinCeiling); a staff account given this role does. The desk work
    // (DESK_WORK) is among them.
    permissions: [
      "approvals.view",
      "checkIn.view",
      "checkIn.warmup",
      "competitionStudios.view",
      "competitions.view",
      "dashboard.view",
      "marshalling.view",
      "overview.view",
      "registrations.attendance",
      "registrations.bracket",
      "registrations.create",
      "registrations.edit",
      "registrations.export",
      "registrations.pair",
      "registrations.partners",
      "registrations.payment",
      "registrations.view",
      "registrations.waitlist",
      "results.view",
      "scores.view",
      "settings.view",
      "shirts.view",
      "studios.view",
      "waveControl.control",
      "waveControl.view",
      "waves.edit",
      "waves.placeTeams",
      "waves.view",
      "zoneStaff.assign",
      "zoneStaff.view",
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
    // The judge sheet and nothing else: their zone, their station, the team
    // on it now or coming next, and its score. No Waves, Score entry, Wave
    // control or zone lists — those show every team of the competition. A
    // zone LEADER's extra powers come from the post, not from more keys
    // (zone-staff.ts, canControlWave).
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
