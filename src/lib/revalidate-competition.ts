import "server-only";

import { revalidatePath } from "next/cache";

/**
 * Competition data is shared by the console, studio, participant and public
 * result views. Invalidate their actual route files after a successful write.
 * Patterns avoid confusing a database series ID with the slug in a URL, and
 * cover dependent tabs already prefetched by the same signed-in browser.
 */
export function revalidateCompetitionViews() {
  for (const path of [
    "/(app)/(platform)",
    "/(app)/(competition)/series/[series]",
    "/(app)/(studio)/studio/[series]",
  ]) {
    revalidatePath(path, "layout");
  }

  for (const path of [
    "/(app)/(studio)/studio",
    "/(app)/(board)/series/[series]/board",
    // The screens over the rigs. They poll for themselves every ten seconds,
    // but their FIRST render is the server's — and a screen switched on mid-
    // competition would otherwise open on a cached floor from before the
    // change, and sit on it until the first poll.
    "/(app)/(board)/series/[series]/station/[zone]/[station]",
    "/(app)/(board)/series/[series]/zone/[zone]/stations",
    "/(app)/(me)/me",
    "/(app)/(me)/me/edit",
    // Pairing a team clears "looking for a partner" on both sides, so the
    // finder's list and anybody's open requests change with a competition
    // write just as the athlete's own page does.
    "/(app)/(me)/me/partner",
    "/(app)/(me)/me/partner/requests",
    "/(app)/home",
    "/(app)/my-wave",
    "/(app)/my-wave/[id]",
    "/(public)/results",
    "/(public)/results/[series]/[category]/[division]",
    "/(public)/results/[series]/team/[teamId]",
  ]) {
    revalidatePath(path, "page");
  }
}
