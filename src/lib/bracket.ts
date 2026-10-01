import type { Category, Division } from "@/generated/prisma/enums";
import { isFloorAccount, type CurrentUser } from "@/lib/access";
import type { DoorTeam } from "@/lib/ownership";
import { CATEGORIES } from "@/lib/scoring";

// ─────────────────────────────────────────────────────────────────────────────
// A TEAM'S BRACKET — its category (Womens / Mens / Mixed) and its level
// (Rookie / Open / Pro) — and the rules for CHANGING it.
//
// The bracket is the TEAM's, never one athlete's: it decides who the pair is
// ranked against and, through the level, the loads they lift. So a change is
// made on the team registration and everything reads it from there.
//
// WHO: an athlete on the team, from their own page; or staff holding
// `registrations.bracket`, on the athlete's behalf, after confirming the
// athlete asked for it and approves (bracket-change.ts).
//
// WHEN — two sides, two clocks (BFT MENA's decision, 30 Sept 2026):
//
//   THE TEAM'S SIDE   the athlete themselves, and their gym. Until the
//                     competition's own cutoff: `Series.teamEditCloseHours`
//                     before the start — 24 by default, set per competition
//                     in Settings → Team changes. Never once their wave has
//                     started.
//   THE FLOOR'S SIDE  BFT MENA and the event staff at the desk (isFloorAccount).
//                     Until a score has been entered for that team — minutes
//                     before the start, or with the wave already called, is
//                     fine: "nobody else entered Open" is learnt at the door.
//
//   Nobody, on either side, changes the bracket of a team that has a score, a
//   withdrawn team, or a finished competition: a bracket is what a result is
//   ranked in. A team already placed keeps its wave and station; nothing on
//   the schedule moves.
//
// WHAT:
//   · CATEGORY — the three every competition offers. Womens cannot hold
//     somebody registered as a man, nor Mens somebody registered as a woman:
//     the rule pairing and sign-up already apply (enter-pair.ts, pairing.ts).
//   · LEVEL — Rookie ↔ Open, either way. Anything into or out of Pro stays
//     BFT MENA's, as a change of division always has been.
//
// Pure: the server decides with these, and the screens draw with them.
// ─────────────────────────────────────────────────────────────────────────────

/** The levels an athlete, a gym or event staff may move a team between. */
export const OPEN_LEVELS: Division[] = ["Rookie", "Open"];

export type BracketClosed = "NOT_FOUND" | "SERIES_FINISHED" | "TEAM_ALREADY_SCORED" | "WAVE_STARTED" | "TEAM_EDIT_CLOSED";
export type CategoryBlock = "WOMENS_HAS_A_MAN" | "MENS_HAS_A_WOMAN";
export type LevelBlock = "PRO_IS_BFT_MENA";

export type BracketError =
  | BracketClosed
  | CategoryBlock
  | LevelBlock
  | "FORBIDDEN"
  | "INVALID_INPUT"
  /** The page showed a bracket the team no longer has. */
  | "STALE_BRACKET"
  /** Staff saved without confirming the athlete asked for it and approves. */
  | "APPROVAL_REQUIRED"
  /**
   * The team runs manually in another category's block: changing its
   * category would make a new scheduling exception nobody chose. Its slot is
   * resolved first — moved, or returned to Auto Assign.
   */
  | "PROTECTED_SLOT";

/** Whose clock applies: see WHEN above. */
export type BracketSide = "team" | "floor";

/**
 * An athlete is always the team's side, and so is their gym. The floor's side
 * is BFT MENA and event staff, helping an athlete (`by: "staff"`).
 */
export function bracketSide(actor: Pick<CurrentUser, "role">, by: "athlete" | "staff"): BracketSide {
  return by === "staff" && isFloorAccount(actor) ? "floor" : "team";
}

export type BracketDoorTeam = DoorTeam & {
  /** `Series.teamEditCloseHours`: hours before the start at which the team's side closes. */
  closeHours: number;
};

export type BracketDoor = { open: true } | { open: false; reason: BracketClosed };

/** The moment the team's side closes: the competition's start, less its own cutoff. */
export function bracketClosesAt(team: Pick<BracketDoorTeam, "competitionDate" | "closeHours">): Date {
  return new Date(team.competitionDate.getTime() - team.closeHours * 3_600_000);
}

export function bracketDoor(team: BracketDoorTeam, side: BracketSide, now: Date): BracketDoor {
  if (team.archivedAt) return { open: false, reason: "NOT_FOUND" };
  if (team.seriesStatus === "final" || team.seriesArchived) return { open: false, reason: "SERIES_FINISHED" };
  // A score is a result in a bracket: from here nobody moves the team.
  if (team.scored) return { open: false, reason: "TEAM_ALREADY_SCORED" };
  if (side === "floor") return { open: true };
  if (team.waveId && team.waveStatus !== "pending") return { open: false, reason: "WAVE_STARTED" };
  if (now.getTime() >= bracketClosesAt(team).getTime()) return { open: false, reason: "TEAM_EDIT_CLOSED" };
  return { open: true };
}

/** `sexes`: "m" / "f" as each member stated it; null where nobody said. */
export function categoryBlock(category: Category, sexes: readonly (string | null | undefined)[]): CategoryBlock | null {
  if (category === "Womens" && sexes.includes("m")) return "WOMENS_HAS_A_MAN";
  if (category === "Mens" && sexes.includes("f")) return "MENS_HAS_A_WOMAN";
  return null;
}

/** Rookie ↔ Open for whoever may change a bracket; Pro, either way, for BFT MENA. */
export function levelBlock(from: Division, to: Division, bft: boolean): LevelBlock | null {
  if (from === to || bft) return null;
  return from === "Pro" || to === "Pro" ? "PRO_IS_BFT_MENA" : null;
}

/** What one team's bracket panel needs to draw itself honestly. Plain data. */
export type BracketFacts = {
  teamId: string;
  category: Category;
  division: Division;
  /** Whose clock the person looking is on. */
  side: BracketSide;
  /** Why nothing can change now, or null while the door is open. */
  closed: BracketClosed | null;
  /** The team's side only: when it closes (or closed), as an ISO instant. */
  closesAt: string | null;
  /** The same moment as people read it — Qatar time, their language. Set by the loader. */
  closesAtLabel?: string;
  /** The categories this pair cannot enter, and why. */
  blockedCategories: Partial<Record<Category, CategoryBlock>>;
  /** Whoever is looking may move the team into or out of Pro (BFT MENA). */
  proAllowed: boolean;
};

export function bracketFacts(
  team: { id: string; category: Category; division: Division; sexes: readonly (string | null | undefined)[] } & BracketDoorTeam,
  viewer: { side: BracketSide; bft: boolean },
  now: Date
): BracketFacts {
  const door = bracketDoor(team, viewer.side, now);
  const blockedCategories: BracketFacts["blockedCategories"] = {};
  for (const category of CATEGORIES) {
    const block = categoryBlock(category, team.sexes);
    if (block && category !== team.category) blockedCategories[category] = block;
  }
  return {
    teamId: team.id,
    category: team.category,
    division: team.division,
    side: viewer.side,
    closed: door.open ? null : door.reason,
    closesAt: viewer.side === "team" ? bracketClosesAt(team).toISOString() : null,
    blockedCategories,
    proAllowed: viewer.bft,
  };
}

/** The levels a panel offers: Rookie and Open, and Pro where it is in play. */
export function levelChoices(facts: Pick<BracketFacts, "division" | "proAllowed">): { value: Division; allowed: boolean }[] {
  const pro = facts.division === "Pro";
  return [
    { value: "Rookie" as const, allowed: facts.proAllowed || !pro },
    { value: "Open" as const, allowed: facts.proAllowed || !pro },
    ...(facts.proAllowed || pro ? [{ value: "Pro" as const, allowed: facts.proAllowed || pro }] : []),
  ];
}
