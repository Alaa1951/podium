// A TEAM'S SCORE AS THE WALL MAY SHOW IT.
//
// Zones are judged and submitted one by one, by different judges, so a team
// reaches the board with its first submitted zone and climbs as the rest
// arrive. During a live competition, saved entries also reach the wall while
// their judge is counting; this does not submit or lock those zones. Scheduled
// and final competitions continue to show only zones submitted at least once.
//
// A score UNLOCKED for correction (scores.unlock) stays on the board: its
// zones were submitted once (they keep `submittedAt`), so they are shown with
// their values as they stand, and a saved correction re-ranks the team at once.
//
// Pure: board.ts builds the payload with it and the tests read it directly.

export type BoardZoneScore = { number: number; name: string; points: number; submitted: boolean };

export function boardScore(
  zones: readonly { id: string; number: number; name: string; points: number }[],
  /** Zones submitted now or once (queries.ts › publishedZones). */
  shownZones: readonly string[],
  /** Zones with saved values during a live competition; never a lock. */
  liveZones: readonly string[] = []
): { zones: BoardZoneScore[]; total: number; scored: boolean } {
  const shownIds = new Set([...shownZones, ...liveZones]);
  // Summed in hundredths, as totalPoints does, so 23.6 + 13.5 is 37.1 exactly.
  let hundredths = 0;
  const shown = zones.map((zone) => {
    const submitted = shownIds.has(zone.id);
    if (submitted) hundredths += Math.round(zone.points * 100);
    return { number: zone.number, name: zone.name, points: submitted ? zone.points : 0, submitted };
  });
  return { zones: shown, total: hundredths / 100, scored: shown.some((zone) => zone.submitted) };
}
