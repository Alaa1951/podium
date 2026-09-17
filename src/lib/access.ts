import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";

// ─────────────────────────────────────────────────────────────────────────────
// The access rules, and nothing else.
//
// Deliberately free of imports that touch the database, the session or the
// network: these are pure decisions about who may see and do what, so they can
// be read in one sitting, tested exhaustively (access.test.ts), and reviewed as
// a security surface on their own. `session.ts` is the thin layer that resolves
// the current user and applies them.
//
// Nothing here is a secret — knowing the rules does not let anyone past them,
// because every one of them is enforced on the server against the database.
// ─────────────────────────────────────────────────────────────────────────────

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  studioId: string | null;
  locale: string;
  /** The permission keys this account resolves to. Admin carries ["*"]. */
  permissions: string[];
  /**
   * Set when an admin is looking through this account's eyes — a read-only
   * preview (see lib/view-as.ts). Its presence is also how screens say so.
   */
  viewAs?: { byAdminId: string };
};

// ── The permission catalog ───────────────────────────────────────────────────
// Grouped by the part of the system they belong to. One key per screen a role
// may open (`*.view`) and one per thing it may change (`*.manage` — a manage
// key never implies its view; grant both when both are wanted, so Block /
// Partial / Full stay honest and never overlap). This catalog is what the
// Roles screen renders and the only vocabulary `can()` understands.

export type PermissionDef = { key: string; label: string; labelAr: string };
export type PermissionGroup = {
  key: string;
  label: string;
  labelAr: string;
  permissions: PermissionDef[];
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "platform",
    label: "Platform",
    labelAr: "المنصة",
    permissions: [
      { key: "users.view", label: "View users", labelAr: "عرض المستخدمين" },
      {
        key: "users.manage",
        label: "Invite, edit, block and remove users",
        labelAr: "دعوة وتعديل وإيقاف وإزالة المستخدمين",
      },
      { key: "studios.view", label: "View studios", labelAr: "عرض الاستوديوهات" },
      {
        key: "studios.manage",
        label: "Add studios to the platform",
        labelAr: "إضافة الاستوديوهات إلى المنصة",
      },
      { key: "audit.view", label: "View the audit log", labelAr: "عرض سجل التغييرات" },
      { key: "announcements.view", label: "View announcements", labelAr: "عرض الإعلانات" },
      { key: "announcements.manage", label: "Send announcements", labelAr: "إرسال الإعلانات" },
      {
        key: "roles.manage",
        label: "Create roles and set permissions",
        labelAr: "إنشاء الأدوار وتحديد الصلاحيات",
      },
    ],
  },
  {
    key: "competition",
    label: "Competition",
    labelAr: "البطولة",
    permissions: [
      {
        key: "competitors.view",
        label: "See registered competitors",
        labelAr: "عرض المتنافسين المسجلين",
      },
      {
        key: "competitors.manage",
        label: "Register, edit and archive teams",
        labelAr: "تسجيل وتعديل وأرشفة الفرق",
      },
      { key: "scores.view", label: "See the score sheet", labelAr: "عرض شيت الدرجات" },
      { key: "scores.edit", label: "Enter and correct scores", labelAr: "إدخال وتصحيح الدرجات" },
      { key: "waves.view", label: "See the wave schedule", labelAr: "عرض جدول الموجات" },
      {
        key: "waves.manage",
        label: "Start waves and assign teams to them",
        labelAr: "تشغيل الموجات وتوزيع الفرق عليها",
      },
      { key: "results.view", label: "See results and podiums", labelAr: "عرض النتائج والمنصات" },
      { key: "board.view", label: "Open the live board", labelAr: "فتح اللوحة المباشرة" },
      {
        key: "settings.view",
        label: "See competition settings",
        labelAr: "عرض إعدادات البطولة",
      },
      {
        key: "settings.manage",
        label: "Edit competition settings",
        labelAr: "تعديل إعدادات البطولة",
      },
      { key: "sponsors.manage", label: "Manage sponsor logos", labelAr: "إدارة شعارات الرعاة" },
      {
        key: "publish.manage",
        label: "Publish results to the public site",
        labelAr: "نشر النتائج على الموقع العام",
      },
    ],
  },
];

/** Every valid permission key, flattened — the grant vocabulary. */
export const ALL_PERMISSION_KEYS: string[] = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((permission) => permission.key)
);

/** What a plain studio account resolves to when it has no custom access role. */
export const DEFAULT_STUDIO_PERMISSIONS = [
  "competitors.view",
  "competitors.manage",
  "scores.view",
  "scores.edit",
  "waves.view",
  "results.view",
  "board.view",
  "announcements.view",
  "announcements.manage",
];

/** What a plain competitor resolves to: the member screens only. */
export const DEFAULT_COMPETITOR_PERMISSIONS: string[] = [];

/**
 * THE one permission decision. Admins pass everything; everyone else passes
 * when their resolved permission list carries the key.
 */
export function can(user: CurrentUser, permission: string): boolean {
  if (user.role === "admin") return true;
  return user.permissions.includes(permission);
}

/**
 * The sentinel a scoped query falls back to when an account has no studio.
 * It is a value that matches no row, so the failure mode of a misconfigured
 * studio account is "sees nothing" rather than "sees everything".
 */
export const NO_MATCH = "__none__";

export const isAdmin = (user: CurrentUser) => user.role === "admin";
export const isStudio = (user: CurrentUser) => user.role === "studio";
export const isCompetitor = (user: CurrentUser) => user.role === "competitor";

/**
 * The team rows this user is allowed to see, as a Prisma filter.
 *
 * - BFT MENA sees every team.
 * - A studio sees only the teams it registered.
 * - A member sees only the team they are an competitor on — never their studio's
 *   other teams, which are other competitors' business.
 */
export function teamScope(user: CurrentUser): Prisma.TeamWhereInput {
  if (user.role === "admin") return {};
  if (user.role === "studio") return { studioId: user.studioId ?? NO_MATCH };
  return { competitors: { some: { userId: user.id } } };
}

/** The account rows this user may list and manage. */
export function accountScope(user: CurrentUser): Prisma.UserWhereInput {
  if (user.role === "admin") return {};
  if (user.role === "studio") return { studioId: user.studioId ?? NO_MATCH };
  return { id: user.id };
}

export type EditDecision =
  | { allowed: true }
  | { allowed: false; reason: "FORBIDDEN" | "EDIT_BUDGET_SPENT" };

/**
 * Whether this user may enter or correct a score for a given team.
 *
 * `budget` is how many writes the studio gets in total, and it comes from the
 * series — `studioScoreCorrections + 1`. The BFT manual's own rule is one write
 * and no more ("once you SAVE the team score it will convert to SUBMITTED, and
 * you are unable to edit the score"), which is `studioScoreCorrections = 0`;
 * MENA may hand out a correction per series without touching this file.
 *
 * The count is a stored counter on the team, so the limit survives a reload, a
 * second tab, or a request that skips the interface entirely.
 */
export function canEditScore(
  user: CurrentUser,
  team: { studioId: string | null; scoreEdits: number },
  budget: number
): EditDecision {
  if (user.role === "admin") return { allowed: true };
  if (user.role !== "studio") return { allowed: false, reason: "FORBIDDEN" };
  if (!user.studioId || team.studioId !== user.studioId) {
    return { allowed: false, reason: "FORBIDDEN" };
  }
  if (team.scoreEdits >= Math.max(0, budget)) {
    return { allowed: false, reason: "EDIT_BUDGET_SPENT" };
  }
  return { allowed: true };
}

/**
 * The budget a series grants, as a number of writes.
 *
 * Corrections are counted on top of the submission itself, because that is how
 * the setting reads to the person filling it in: "how many times may a studio
 * come back and fix it?".
 */
export const scoreWriteBudget = (series: { studioScoreCorrections: number }) =>
  series.studioScoreCorrections + 1;

export type ScoreWriteDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "FORBIDDEN" | "EDIT_BUDGET_SPENT" | "SCORE_ENTRY_CLOSED";
    };

/**
 * THE WHOLE RULE for writing a score, in one place.
 *
 * Three separate things have to be true, and for a while only one of them was
 * actually checked: the series has to let studios enter scores at all, the
 * cut-off has to be in the future, and the team's edit budget has to be
 * unspent. Composing them here rather than inline in the server action is what
 * makes the rule testable — `saveScore` now has nothing to get subtly wrong.
 *
 * BFT MENA passes every gate. It runs the competition, and the manual's own
 * process is that late corrections go to HQ, which means HQ has to be able to
 * make them.
 */
export function canWriteScore(
  user: CurrentUser,
  team: { studioId: string | null; scoreEdits: number },
  series: {
    studiosMayEnterScores: boolean;
    studioScoreCorrections: number;
    scoreEntryClosesAt: Date | null;
  },
  now: Date
): ScoreWriteDecision {
  if (user.role === "admin") return { allowed: true };

  if (!series.studiosMayEnterScores) return { allowed: false, reason: "FORBIDDEN" };

  if (series.scoreEntryClosesAt && now >= series.scoreEntryClosesAt) {
    return { allowed: false, reason: "SCORE_ENTRY_CLOSED" };
  }

  return canEditScore(user, team, scoreWriteBudget(series));
}

/** Series, events, the wave clock and the schedule: BFT MENA only. */
export const canManageEvent = (user: CurrentUser) => user.role === "admin";

export const canRegisterTeams = (user: CurrentUser) =>
  user.role === "admin" || user.role === "studio";

export const canManageAccounts = (user: CurrentUser) =>
  user.role === "admin" || user.role === "studio";

/**
 * Who a given account may create. BFT MENA issues admin and studio accounts; a
 * studio issues competitors, always into its own studio whatever was submitted.
 */
export function canCreateAccount(
  actor: CurrentUser,
  role: Role,
  requestedStudioId: string | null
):
  | { allowed: true; studioId: string | null }
  | { allowed: false; reason: "FORBIDDEN" | "NO_STUDIO" } {
  if (actor.role === "admin") return { allowed: true, studioId: requestedStudioId };
  if (actor.role !== "studio") return { allowed: false, reason: "FORBIDDEN" };
  if (role !== "competitor") return { allowed: false, reason: "FORBIDDEN" };
  if (!actor.studioId) return { allowed: false, reason: "NO_STUDIO" };
  return { allowed: true, studioId: actor.studioId };
}
