// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE IMAGE API IS ASKED FOR.
//
// Two prompts, both fixed. One turns an uploaded photo into a portrait; the
// other stands two finished portraits side by side.
//
// THE MODEL MATTERED MORE THAN THE WORDING. These were first written against
// `gpt-image-1`, which could not reproduce the brand mark, drifted faces when
// combining two pictures, and once replaced the logo with invented words. Half
// the prompt became defensive scaffolding and a whole module existed to
// composite the mark on afterwards. None of that was a limit of the technique
// — it was a limit of a model a year old. On `gpt-image-2.5` the mark is
// copied from the artwork and faces survive the combine, so the scaffolding
// is gone.
//
// WHAT IS NOT SCAFFOLDING, and stays whatever the model can do: the clothing
// rules. Those are a product requirement.
//
// ONE THING TO WATCH WHEN EDITING: never tell the model the shirt is blank and
// then ask it to print something on it. That contradiction was in here for one
// run, and the model resolved it by printing nothing at all.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One athlete. IMAGE 1 is their photograph; IMAGE 2 is the PODIUM mark.
 *
 * The clothing rules are load-bearing. These are athletes in the Gulf, and a
 * model left to its own judgement returns people wearing less than they
 * arrived in. What somebody wears — sleeves, a headscarf, how much is covered
 * — is theirs. The only permitted change is the colour.
 */
export const SOLO_PROMPT = [
  "You are given two images. IMAGE 1 is a photograph of a person.",
  "IMAGE 2 is the PODIUM logo.",
  "Produce one photorealistic studio portrait of the person in IMAGE 1, of the",
  "kind used on an official team roster.",

  // ── Identity ──────────────────────────────────────────────────────────────
  "This is a RETOUCH of a real photograph, not a new picture of a similar",
  "person. Preserve their identity exactly: the same face, bone structure, eye",
  "shape and colour, nose, mouth, jaw, eyebrows, hairline, hair and age. Keep",
  "their expression. Keep any freckles, lines, marks or asymmetry — those are",
  "what make the face theirs.",
  "Keep their build and posture exactly as photographed. Do not slim them, do",
  "not broaden them and do not add muscle definition.",
  "Skin must read as real skin: visible pores and texture, natural variation",
  "in tone. Do NOT smooth, airbrush, beautify or apply any skin filter.",

  // ── Clothing ──────────────────────────────────────────────────────────────
  "CLOTHING — all four rules are mandatory:",
  "1. Keep the SAME SLEEVE LENGTH as the original. Long sleeves stay long to",
  "the wrist; short sleeves stay short. Never substitute one for the other.",
  "2. If a headscarf or hijab is worn, keep it — the same wrap, the same",
  "coverage, the same way it sits. Only its colour becomes white. Never remove",
  "it and never reveal hair it covers.",
  "3. If the hair is uncovered, keep the hair exactly as it is.",
  "4. Keep the same neckline and the same amount of the body covered. Never",
  "expose any skin that the original photograph covers.",
  "Change ONLY the colour of the garment, to clean white. Keep its cut, fit",
  "and fabric. It carries no pattern, stripe, number or badge of its own — the",
  "one thing printed on it is the mark described next, and that mark must",
  "appear.",

  // ── The mark ──────────────────────────────────────────────────────────────
  "Print the logo from IMAGE 2 onto the garment, on the wearer's LEFT chest —",
  "which appears on the RIGHT half of the frame as you look at it — centred",
  "between the collarbone and the armpit.",
  "It must be about 12 percent of the image width, and a faithful reproduction",
  "of IMAGE 2: the same letterforms, the same slant and the same proportions.",
  "REPRODUCE ITS COLOURS EXACTLY AS THEY APPEAR IN IMAGE 2. The mark is not one",
  "colour: the PODIUM wordmark is pure blue (#0000FF), the BFT letters beneath",
  "it are a lighter cyan (#00B5CC), and the word MENA under those is near-black.",
  "Keep those three apart — do not unify them into a single colour, do not tint",
  "one toward another and do not shift the blue lighter, darker or greener.",
  "Include every element of IMAGE 2, MENA included; drop nothing and add",
  "nothing. Do not re-letter or restyle it.",
  "Print it as ink on cloth, following the drape and fold of the fabric and",
  "catching the same light as the shirt.",

  // ── The photograph ────────────────────────────────────────────────────────
  "Seamless studio backdrop in solid electric blue, hex #0000FF, evenly lit,",
  "with no gradient, texture or vignette.",
  "Shot on an 85mm lens at eye level: a large soft key light slightly to one",
  "side, gentle fill, a faint rim separating them from the backdrop. Natural",
  "contrast, no heavy shadows, no colour cast on the skin.",
  "Frame from the waist up, centred, squarely facing the camera, the chest",
  "clear and unobstructed. Sharp focus on the eyes.",
  "No other text, watermark, border or graphic anywhere — the PODIUM mark from",
  "IMAGE 2 is the only thing printed, and it must be there.",
].join(" ");

/**
 * The pair. Both inputs are finished portraits from the prompt above, so they
 * already share a backdrop, a light and a framing — this is an arrangement,
 * not an invention, which is what carries two faces through the pass intact.
 */
export const COMPOSITE_PROMPT = [
  "You are given two finished studio portraits of two teammates, photographed",
  "against the same blue backdrop under the same light.",
  "Produce ONE photorealistic team photograph of the two of them standing",
  "together, as though taken in a single frame in that same session.",

  "Place the person from IMAGE 1 on the left and the person from IMAGE 2 on",
  "the right, shoulder to shoulder, both squarely facing the camera, at the",
  "same scale, the same height in frame and on the same ground line.",

  // ── Identity, stated as the priority ──────────────────────────────────────
  "COPY EACH FACE FROM ITS SOURCE IMAGE. Do not generate a new face that",
  "resembles the original: every feature must match its portrait — eyes, nose,",
  "mouth, jaw, eyebrows, hairline, hair, skin tone, skin texture, expression",
  "and age. Keep the pores and the natural imperfections. Do not smooth,",
  "airbrush or beautify either face. Keep each person's build and their folded",
  "arms exactly as they are.",

  "Keep each garment exactly as it appears in its own source: the same white",
  "top, the same cut, the same neckline and the same sleeve length — theirs",
  "differ and must stay different. If either wears a headscarf, keep it",
  "exactly as it is.",

  // Stated as a requirement, not a preservation: a preservation is the kind of
  // instruction a model quietly drops.
  "EACH SHIRT MUST CARRY THE PODIUM LOGO on the wearer's left chest, exactly",
  "as it appears in that person's source image: the same letterforms, the same",
  "size and the same position.",
  "ITS COLOURS MUST MATCH THE SOURCE EXACTLY. The mark is three colours, not",
  "one: the PODIUM wordmark pure blue (#0000FF), the BFT letters cyan",
  "(#00B5CC), the word MENA near-black. Keep all three, keep them distinct, and",
  "do not tint, unify or shift any of them.",
  "Do not redraw or re-letter it, and do not omit it or any part of it.",
  "Add no other text, badge or graphic anywhere.",

  "One continuous seamless backdrop in solid electric blue, hex #0000FF, with",
  "no join, seam or difference in brightness between the two halves. Light",
  "both people identically, as the single key light of one studio setup would.",
  "Shot on an 85mm lens at eye level, waist up, sharp focus on both faces.",
].join(" ");
