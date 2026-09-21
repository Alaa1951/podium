// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE IMAGE API IS ASKED FOR.
//
// Kept in their own file so wording can be tuned — and it will be, repeatedly —
// without touching the runner, the client or a single test.
//
// THE BRAND IS NOT IN THE PROMPT, and that is deliberate. Image models cannot
// reproduce a specific logo or specific lettering; they produce something that
// resembles it and text that is subtly wrong. `docs/brand.md` says the mark is
// never redrawn. So the model is asked for a PLAIN WHITE SHIRT and nothing
// more, and every branded element — the mark, the name, the category, the
// frame — is drawn by us around the result, which is also how the reference
// posters are made.
// ─────────────────────────────────────────────────────────────────────────────

/** One athlete, restyled into the poster look. */
export const SOLO_PROMPT = [
  "Restyle this photograph as a professional sports competition poster portrait.",
  "Keep the person's face, build and skin tone exactly as they are — this must",
  "remain recognisably the same person.",
  "Three-quarter body, turned slightly side-on, arms folded, looking at camera.",
  "Dress them in a plain white short-sleeved athletic t-shirt with no text,",
  "no logo and no print of any kind.",
  "Dark neutral studio background, single strong key light from one side,",
  "high contrast, crisp edges.",
  "No text, no watermark, no border, no graphics anywhere in the image.",
].join(" ");

/** The pair, from their two finished portraits. */
export const COMPOSITE_PROMPT = [
  "Combine these two portraits into a single team poster image, side by side,",
  "both people at the same scale and standing on the same ground line.",
  "Keep each face exactly as it is in its source image.",
  "Match the lighting and the dark neutral background across both so the result",
  "reads as one photograph rather than two cut out and pasted.",
  "Both wear the same plain white t-shirt with no text or logo.",
  "No text, no watermark, no border, no graphics anywhere in the image.",
].join(" ");
