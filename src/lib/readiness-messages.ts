import type { AthleteGap, TeamGap, TeamGaps } from "@/lib/readiness";
import type { WaiverState } from "@/lib/waivers/status";

// ─────────────────────────────────────────────────────────────────────────────
// What each gap is called on the desks and on Wave control — one wording for
// all three, and each says what to do about it. Translation keys.
// ─────────────────────────────────────────────────────────────────────────────

type T = (key: string, vars?: Record<string, string | number>) => string;

export const GAP_LABEL: Record<AthleteGap | TeamGap, string> = {
  account: "No PODIUM account yet — the athlete signs in with their registration email, then signs the waiver",
  waiver: "Waiver acceptance required — the athlete signs on their own Waiver Declarations page",
  waiver_resign: "Waiver must be signed again — the athlete signs the current version on their own page",
  entrance: "Not checked in at the entrance",
  registration: "Not holding a place (withdrawn or on the waiting list)",
  no_athletes: "No athletes on the team",
  no_wave: "Not placed in a wave",
  warmup: "Not checked in at warm-up for this wave",
};

/** "#7 FALCONS: Not checked in at warm-up" / "Sara Ali: Waiver acceptance required" */
export function gapLines(result: TeamGaps, t: T): { who: string; what: string[] }[] {
  const team = `#${result.team.number} ${result.team.name}`;
  return [
    ...(result.gaps.length ? [{ who: team, what: result.gaps.map((gap) => t(GAP_LABEL[gap])) }] : []),
    ...result.athletes.map((athlete) => ({ who: athlete.name, what: athlete.gaps.map((gap) => t(GAP_LABEL[gap])) })),
  ];
}

/** The waiver badge on a desk: tone and words. Never more than the state. */
export function waiverBadge(state: WaiverState): { tone: string; label: string } | null {
  switch (state) {
    case "signed": return { tone: "badge-ok", label: "Waiver signed" };
    case "pending": return { tone: "badge-warn", label: "Waiver acceptance required" };
    case "resign": return { tone: "badge-warn", label: "Waiver: re-sign required" };
    case "no_account": return { tone: "badge-warn", label: "No account — cannot sign yet" };
    default: return null;
  }
}
