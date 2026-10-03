import { can, type CurrentUser } from "@/lib/access";

type SheetUser = Pick<CurrentUser, "role" | "permissions">;

/** The sheet route accepts either kind of access; posts narrow what it shows. */
export function canOpenZoneScoreSheet(user: SheetUser): boolean {
  return can(user, "judgeSheet.view") || can(user, "judgeSheet.leaderView");
}

/** Leader-only access never opens a judge or reserve post left on the account. */
export function canViewZoneScoreSheet(user: SheetUser, position: string | null): boolean {
  if (!position) return false;
  return can(user, "judgeSheet.view") || (position === "leader" && can(user, "judgeSheet.leaderView"));
}

/** Eligibility for a post also requires permission to enter its scores. */
export function canAssignZoneScorePost(user: SheetUser, position: string): boolean {
  return can(user, "scores.enter") && canViewZoneScoreSheet(user, position);
}
