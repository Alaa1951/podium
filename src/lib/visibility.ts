import type { Role } from "@/generated/prisma/enums";

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
 */
export function boardAccess(role: Role | "anonymous", phase: EventPhase): BoardAccess {
  if (role === "admin") {
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
      // Own entries only. A studio still manages its teams; it simply cannot
      // read the rest of the field yet.
      return { canSeeBoard: false, scope: "own", canSeeResults: false, isPublic: false };

    case "live":
      return { canSeeBoard: true, scope: "all", canSeeResults: false, isPublic: false };

    case "results":
    case "public":
      return { canSeeBoard: true, scope: "all", canSeeResults: true, isPublic: phase === "public" };
  }
}

// ── Deadlines ────────────────────────────────────────────────────────────────

export type DeadlineState =
  | { open: true }
  | { open: false; reason: "REGISTRATION_CLOSED" | "SCORE_ENTRY_CLOSED" };

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
  if (params.role === "admin") return { open: true };
  if (!params.registrationClosesAt) return { open: true };
  if (params.now < params.registrationClosesAt) return { open: true };
  return { open: false, reason: "REGISTRATION_CLOSED" };
}

/** Whether a studio may still enter or change a score. */
export function scoreEntryOpen(params: {
  role: Role;
  scoreEntryClosesAt: Date | null;
  now: Date;
}): DeadlineState {
  if (params.role === "admin") return { open: true };
  if (!params.scoreEntryClosesAt) return { open: true };
  if (params.now < params.scoreEntryClosesAt) return { open: true };
  return { open: false, reason: "SCORE_ENTRY_CLOSED" };
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
