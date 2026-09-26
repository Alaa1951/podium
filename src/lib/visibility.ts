import type { Role } from "@/generated/prisma/enums";
import { can, type CurrentUser } from "@/lib/access";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT AN EVENT SHOWS, AND WHEN.
//
// The board is not one thing with one audience — it moves through three phases,
// and who may see what changes with them:
//
//   BEFORE   nobody sees anyone else. A studio sees the teams it registered, a
//            competitor sees their own registration. Other studios' entries,
//            waves and timings are not theirs to read yet.
//
//   LIVE     the competition is running, so everyone sees everyone. That is the
//            point of a leaderboard: a team has to be able to see where it
//            stands against the field.
//
//   PUBLIC   the event is over. Full results, open — the same view BFT
//            publishes, reachable without an account once `resultsPublicAt`
//            has passed.
//
// Pure, dependency-free and fully tested (visibility.test.ts), because this is
// the rule that decides whether one studio can read another's data.
// ─────────────────────────────────────────────────────────────────────────────

export type EventPhase = "before" | "live" | "results" | "public";

export type EventTiming = {
  status: "scheduled" | "live" | "final";
  teamCount: number;
  /** Waves are rows now, so the phase is read from their statuses. */
  wavesTotal: number;
  wavesComplete: number;
  wavesRunning: number;
  /**
   * The moment the board is allowed to open. Until it passes, the event is
   * "before" whatever its status says — an operator can mark an event live
   * hours early to rehearse, and the wall screen must still show the countdown.
   */
  boardOpensAt: Date | null;
  /** Null means "no publication time set" — results stay competitor-only. */
  resultsPublicAt: Date | null;
  now: Date;
};

/**
 * Where an event is in its life. `results` means finished but still
 * competitor-only; `public` means open to anyone.
 */
export function eventPhase(timing: EventTiming): EventPhase {
  // The activation time gates everything that follows it.
  if (timing.boardOpensAt && timing.now < timing.boardOpensAt) return "before";

  const running = timing.status === "live" && timing.teamCount > 0;

  // Finished means every scheduled wave is done — not "the last one started",
  // which was the old single-wave reading and is wrong once two run at once.
  const allWavesDone =
    timing.wavesTotal > 0 && timing.wavesComplete >= timing.wavesTotal && timing.wavesRunning === 0;

  const finished = timing.status === "final" || (running && allWavesDone);

  if (!finished) return running ? "live" : "before";

  const published =
    timing.resultsPublicAt !== null && timing.now >= timing.resultsPublicAt;

  return published ? "public" : "results";
}

export type BoardAccess = {
  /** May this person open the board at all? */
  canSeeBoard: boolean;
  /** Does the board show every studio, or only their own teams? */
  scope: "all" | "own" | "none";
  /** May they open winners and the full results lookup? */
  canSeeResults: boolean;
  /** May an anonymous visitor read this? */
  isPublic: boolean;
};

/**
 * What a given role may see of an event in a given phase.
 *
 * BFT MENA is exempt: it runs the event and must be able to check the board
 * before anyone else can, or nothing could be rehearsed.
 *
 * The live board is open to every signed-in account — even one still waiting
 * for approval. Before the event that means the countdown and nothing of the
 * field; the board itself opens when the event does.
 */
export function boardAccess(role: Role | "anonymous", phase: EventPhase): BoardAccess {
  if (role === "admin" || role === "staff") {
    return { canSeeBoard: true, scope: "all", canSeeResults: true, isPublic: false };
  }

  if (role === "anonymous") {
    // Only a published event is readable without an account, and only its
    // results — never the pre-event registration data.
    const open = phase === "public";
    return {
      canSeeBoard: open,
      scope: open ? "all" : "none",
      canSeeResults: open,
      isPublic: open,
    };
  }

  switch (phase) {
    case "before":
      // The countdown only. A studio still manages its own teams elsewhere; the
      // rest of the field is nobody else’s to read yet.
      return { canSeeBoard: true, scope: "own", canSeeResults: false, isPublic: false };

    case "live":
      return { canSeeBoard: true, scope: "all", canSeeResults: false, isPublic: false };

    case "results":
    case "public":
      return { canSeeBoard: true, scope: "all", canSeeResults: true, isPublic: phase === "public" };
  }
}

/**
 * Whether this person reads the WHOLE field's board payload — what the rig
 * screens and the board's poll carry. boardAccess's "all" scope, or the floor
 * supervisor (waveControl.view): they open the rig screens from Wave control
 * and have to see them working before the doors open, not after.
 */
export function readsWholeBoard(user: Pick<CurrentUser, "role" | "permissions">, phase: EventPhase): boolean {
  const access = boardAccess(user.role, phase);
  if (access.canSeeBoard && access.scope === "all") return true;
  return user.role !== "studio" && user.role !== "competitor" && can(user, "waveControl.view");
}

// ── Deadlines ────────────────────────────────────────────────────────────────

export type DeadlineState =
  | { open: true }
  | { open: false; reason: "REGISTRATION_CLOSED" | "SCORE_ENTRY_CLOSED" | "TEAM_EDIT_CLOSED" };

const HOUR_MS = 3_600_000;

/**
 * Whether a studio may still register, edit or remove teams.
 *
 * BFT MENA is never blocked by a deadline — the manual's own process is that
 * late changes go to HQ, which means HQ has to be able to make them.
 */
export function registrationOpen(params: {
  role: Role;
  registrationClosesAt: Date | null;
  now: Date;
}): DeadlineState {
  if (params.role === "admin" || params.role === "staff") return { open: true };
  if (!params.registrationClosesAt) return { open: true };
  if (params.now < params.registrationClosesAt) return { open: true };
  return { open: false, reason: "REGISTRATION_CLOSED" };
}

/**
 * Whether somebody was in time for the field, or belongs on the waiting list.
 *
 * A SEPARATE question from `registrationOpen`, not a third state inside it.
 * Three of that function's callers ask "may I edit or withdraw this entry?",
 * where "you are on the waiting list" is not an answer at all — folding the
 * two together would put a meaningless branch in front of every one of them,
 * and the wrong branch is the one that eventually gets taken.
 *
 * It takes no `now` and no `role`, and that is the whole design. The moment
 * that decides is the moment they SIGNED UP, which is already stored, so the
 * answer cannot change because a studio was slow to approve them or because
 * the question was asked again a day later. Somebody who made the deadline
 * keeps their place even if the paperwork took a week.
 */
export type EntryPlace = "field" | "waiting_list";

export function entryPlace(params: {
  /** When this person asked to take part. Null for an entry staff typed in. */
  signedUpAt: Date | null;
  registrationClosesAt: Date | null;
}): EntryPlace {
  // No deadline set means the door never closed, so nobody is waiting.
  if (!params.registrationClosesAt) return "field";
  // Staff entering somebody by hand have decided; there is nothing to check.
  if (!params.signedUpAt) return "field";
  return params.signedUpAt < params.registrationClosesAt ? "field" : "waiting_list";
}

/** Whether a studio may still enter or change a score. */
export function scoreEntryOpen(params: {
  role: Role;
  scoreEntryClosesAt: Date | null;
  now: Date;
}): DeadlineState {
  if (params.role === "admin" || params.role === "staff") return { open: true };
  if (!params.scoreEntryClosesAt) return { open: true };
  if (params.now < params.scoreEntryClosesAt) return { open: true };
  return { open: false, reason: "SCORE_ENTRY_CLOSED" };
}

/**
 * Whether a MEMBER may still change their own pair — the roster on their team,
 * or who their partner is.
 *
 * Counted back from the competition, in hours, so BFT MENA sets one number
 * rather than a date per competition.
 *
 * It takes no `role`, unlike the two above, and that is deliberate. Those
 * exempt BFT MENA because the manual's own process is that late changes go to
 * HQ through those paths. This one answers a different question — what an
 * ATHLETE may do to their own pair — and staff never route through it: they
 * have the wave guard instead, which is stricter and about the floor. A
 * `role` parameter here would be an invitation to pass "admin" and quietly
 * reopen the athlete's door.
 */
export function teamEditOpen(params: {
  competitionDate: Date;
  teamEditCloseHours: number;
  now: Date;
}): DeadlineState {
  const cutoff = params.competitionDate.getTime() - params.teamEditCloseHours * HOUR_MS;
  if (params.now.getTime() < cutoff) return { open: true };
  return { open: false, reason: "TEAM_EDIT_CLOSED" };
}

// ── Board presentation ───────────────────────────────────────────────────────

export type BoardDisplay = {
  showTeamName: boolean;
  showCompetitorNames: boolean;
  showStudioColumn: boolean;
};

/**
 * How a team is labelled on the board.
 *
 * BFT International prints the two competitors; MENA may want the registered team
 * name, or both. Both flags off would leave a nameless row, so the team name
 * wins as the last resort rather than showing nothing.
 */
export function teamLabel(
  team: { name: string; competitors: string[] },
  display: BoardDisplay
): { primary: string; secondary: string | null } {
  const competitors = team.competitors.filter(Boolean).join(" & ");

  if (display.showTeamName && display.showCompetitorNames) {
    return { primary: team.name, secondary: competitors || null };
  }
  if (display.showCompetitorNames && competitors) {
    return { primary: competitors, secondary: null };
  }
  return { primary: team.name, secondary: null };
}
