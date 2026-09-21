// ─────────────────────────────────────────────────────────────────────────────
// THE PORTRAIT A SEAT SHOWS.
//
// One function, and it exists to be the only answer to "which image?" — so
// that when real portraits arrive there is a single place that changes, and a
// single place that can be read to find out what this app will load.
//
// EVERY PATH IT RETURNS IS SERVED BY THIS APP. It refuses anything that looks
// like somewhere else — a scheme, a protocol-relative prefix, a parent-
// directory escape — and falls back to the default instead. That matters more
// than it looks: the published privacy page promises no third-party requests
// and no third-party CDNs, and a portrait is the sort of field that quietly
// becomes a foreign URL one hotfix at a time. `src/proxy.ts` sets
// `img-src 'self' data: blob:`, so a foreign URL would be blocked and show a
// broken image; this makes the fallback deliberate rather than accidental.
//
// NOTHING HERE CALLS ANYTHING. No generation, no upload, no network. Today
// every seat resolves to the same default and that is the whole feature.
// ─────────────────────────────────────────────────────────────────────────────

/** The portrait every seat falls back to. A drawn placeholder, not a person. */
export const DEFAULT_ATHLETE_PHOTO = "/brand/athlete-default.svg";

/** Anything that would leave this origin. */
function isForeign(path: string): boolean {
  const value = path.trim();
  if (!value) return true;
  // "//evil.example" is protocol-relative and loads from another host.
  if (value.startsWith("//")) return true;
  // "http:", "https:", "data:", "javascript:" — any scheme at all.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return true;
  // Must be rooted here, and must not climb out of it.
  if (!value.startsWith("/")) return true;
  if (value.includes("..")) return true;
  return false;
}

/**
 * The image to show for one seat on a team.
 *
 * Takes the stored path rather than the whole row, so the rule can be read and
 * tested without a database and without a Competitor shaped object.
 */
export function athletePhoto(photoPath: string | null | undefined): string {
  if (!photoPath) return DEFAULT_ATHLETE_PHOTO;
  return isForeign(photoPath) ? DEFAULT_ATHLETE_PHOTO : photoPath.trim();
}
