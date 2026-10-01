// A TEAM'S SCORE AS THE WALL MAY SHOW IT — only what a judge has submitted.
//
// Zones are judged and submitted one by one, by different judges, so a team
// reaches the board with its first submitted zone and climbs as the rest
// arrive. Until then, and for every zone still being scored, nothing the judge
// has typed leaves the server: a zone never submitted is a dash, never a draft
// value, and the total adds up the submitted zones only.
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
  shownZones: readonly string[]
): { zones: BoardZoneScore[]; total: number; scored: boolean } {
  const locked = new Set(shownZones);
  // Summed in hundredths, as totalPoints does, so 23.6 + 13.5 is 37.1 exactly.
  let hundredths = 0;
  const shown = zones.map((zone) => {
    const submitted = locked.has(zone.id);
    if (submitted) hundredths += Math.round(zone.points * 100);
    return { number: zone.number, name: zone.name, points: submitted ? zone.points : 0, submitted };
  });
  return { zones: shown, total: hundredths / 100, scored: shown.some((zone) => zone.submitted) };
}
