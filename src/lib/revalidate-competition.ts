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
    "/(app)/(me)/me",
    "/(app)/(me)/me/edit",
    "/(app)/my-wave",
    "/(app)/my-wave/[id]",
    "/(public)/results",
    "/(public)/results/[series]/[category]/[division]",
    "/(public)/results/[series]/team/[teamId]",
  ]) {
    revalidatePath(path, "page");
  }
}
