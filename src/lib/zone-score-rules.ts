import { can, type CurrentUser } from "@/lib/access";

// ─────────────────────────────────────────────────────────────────────────────
// WHO MAY WRITE ONE ZONE OF ONE TEAM'S SCORE.
//
//   BFT MENA Full     anything, any time — including a submitted zone. The
//                     only correction path (scores.correct is never given).
//   Submitted zone    locked for everyone else.
//   Entry closed      once the competition's score-entry cut-off has passed,
//                     for everyone but Full access — judges included.
//   BFT MENA Partial  with scores.enter: any zone, from the console, until
//                     it is submitted.
//   Zone leader       any station of their own zone, for any wave that has
//                     reached it, while the competition is running — the
//                     zone's safety valve for a sheet a judge left open.
//   Judge / reserve   only the team on their own station, and only in the
//                     wave their zone is ON (floor.ts › waveOnDuty): while it
//                     works there, in the changeover after, and until the
//                     next wave arrives. Never a team that has not reached
//                     the zone, never one the zone has moved on from.
//
// Pure: the action loads the rows and asks this.
// ─────────────────────────────────────────────────────────────────────────────

export type ZonePost = { position: "leader" | "judge" | "reserve"; station: number | null };

export type ZoneWriteFacts = {
  user: Pick<CurrentUser, "role" | "permissions">;
  /** The writer's post on THIS zone, if any. */
  post: ZonePost | null;
  team: { station: number | null };
  seriesStatus: "scheduled" | "live" | "final";
  /** Whether the team's wave has reached this zone (its work there began). */
  reached: boolean;
  /** Whether the team's wave is the one this zone is on now (waveOnDuty). */
  onDuty: boolean;
  zoneSubmitted: boolean;
  /** The competition's score-entry cut-off has passed. */
  entryClosed?: boolean;
};

export type ZoneWriteDecision =
  | { allowed: true; as: "admin" | "console" | "leader" | "judge" }
  | {
      allowed: false;
      reason:
        | "FORBIDDEN"
        | "SCORE_LOCKED"
        | "SCORE_ENTRY_CLOSED"
        | "SERIES_NOT_LIVE"
        | "WAVE_NOT_HERE"
        | "WAVE_MOVED_ON"
        | "NO_STATION"
        | "WRONG_STATION";
    };

export function canWriteZoneScore(facts: ZoneWriteFacts): ZoneWriteDecision {
  const { user, post } = facts;
  if (user.role === "admin") return { allowed: true, as: "admin" };
  if (facts.zoneSubmitted) {
    return can(user, "scores.correct") ? { allowed: true, as: "admin" } : { allowed: false, reason: "SCORE_LOCKED" };
  }
  if (!can(user, "scores.enter")) return { allowed: false, reason: "FORBIDDEN" };
  if (facts.entryClosed) return { allowed: false, reason: "SCORE_ENTRY_CLOSED" };
  if (user.role === "staff") return { allowed: true, as: "console" };

  if (!post) return { allowed: false, reason: "FORBIDDEN" };
  if (facts.seriesStatus !== "live") return { allowed: false, reason: "SERIES_NOT_LIVE" };
  if (!facts.reached) return { allowed: false, reason: "WAVE_NOT_HERE" };
  if (post.position === "leader") return { allowed: true, as: "leader" };
  if (!facts.onDuty) return { allowed: false, reason: "WAVE_MOVED_ON" };
  if (post.station === null) return { allowed: false, reason: "NO_STATION" };
  if (facts.team.station !== post.station) return { allowed: false, reason: "WRONG_STATION" };
  return { allowed: true, as: "judge" };
}
