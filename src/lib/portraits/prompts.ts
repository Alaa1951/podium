// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE IMAGE API IS ASKED FOR.
//
// TWO PROMPTS, both fixed. One turns a single uploaded photo into a portrait;
// the other puts two finished portraits side by side. Nothing else is sent.
//
// THE MODEL IS NEVER SHOWN THE LOGO AND NEVER ASKED FOR ONE. Four attempts
// established why. Described, it drew a generic bold italic in the wrong blue.
// Told in capitals to leave an existing mark alone, it wiped it and wrote
// "PODIUM / GET REAL" — words that appear nowhere in this project. HANDED the
// artwork as a second image, it got closest of all and still only imitated:
// "PODIUM." with an invented full stop, and BFT with its "MENA" dropped.
//
// A generative model redraws any lettering in its field of view. So the shirts
// are generated BLANK and the real file is composited on afterwards
// (brand-mark.ts). Asking here for "no text anywhere" is load-bearing.
//
// WHAT EVERY EARLIER VERSION GOT WRONG, kept so it is not rediscovered:
//   • it dressed people — a long-sleeved top came back a t-shirt
//   • it polished faces — real skin became an advertisement
//   • it reshaped bodies — arms grew
//   • "football squad portrait" made it invent a club crest, underneath a
//     blanket instruction forbidding logos: naming a sport summons its badges
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One athlete, alone, in a blank white garment on a blue backdrop.
 *
 * The clothing rules are not a nicety. These are athletes in the Gulf, and a
 * model left to its own judgement will happily return somebody wearing less
 * than they arrived in. What a person wears — sleeves, a headscarf, how much
 * is covered — is theirs. The only permitted change is the colour.
 */
export const SOLO_PROMPT = [
  "Edit this photograph into an official team roster portrait.",
  "The result must look like a real photograph taken by a camera — not an",
  "illustration, not a render, not a painting.",

  // ── The person ────────────────────────────────────────────────────────────
  "KEEP THE PERSON EXACTLY AS THEY ARE. The same face, the same features, the",
  "same bone structure, the same skin tone, the same expression, the same hair",
  "and the same age. Keep their body and build exactly as it is — do not slim",
  "them and do not make them more muscular. Keep their pose and their arms.",
  "Keep natural skin with visible texture and pores. Do NOT smooth, retouch,",
  "airbrush or beautify the skin. No beauty filter and no glamour retouching.",

  // ── What they are wearing ─────────────────────────────────────────────────
  "CLOTHING RULES, all of them mandatory:",
  "1. Keep the SAME SLEEVE LENGTH they are wearing. Long sleeves stay long to",
  "the wrist. Short sleeves stay short. Never swap one for the other.",
  "2. If the person is wearing a headscarf or hijab, KEEP IT — the same style,",
  "the same coverage, the same way it is worn. Only its colour becomes white.",
  "Never remove it and never show hair that was covered.",
  "3. If the person's hair is uncovered, keep their hair exactly as it is.",
  "4. Keep the same neckline and the same amount of the body covered. Never",
  "expose any part of the body that is covered in the original photograph.",
  "Change ONLY the colour of what they are wearing, to plain white.",
  "The garment must otherwise be completely blank — no pattern, no stripe, no",
  "crest, no badge, no club emblem, no number and no text of its own.",

  // ── The frame ─────────────────────────────────────────────────────────────
  "Place them on a plain, solid, deep electric blue studio background, hex",
  "#0000FF — one flat colour, no gradient, no texture and no vignette.",
  "Even, soft studio lighting. Frame them from the waist up, centred and",
  "squarely facing the camera, with the chest visible.",
  "No other text, no watermark, no border and no graphics anywhere.",
].join(" ");

/**
 * The pair. Both images are finished portraits from the prompt above.
 *
 * They already share a backdrop, a light and a framing, so this asks for an
 * arrangement rather than an invention — which is the most that can be done to
 * carry two faces through a generative pass intact.
 */
export const COMPOSITE_PROMPT = [
  "You are given TWO photographs of two teammates, each taken against the same",
  "blue studio background.",
  "Combine them into ONE team photograph in which the two people stand side by",
  "side, as if photographed together in a single session.",
  "THE RESULT MUST BE PHOTOREALISTIC — a real photograph taken by a camera.",
  "Not an illustration, not a painting, not a 3D render, not a cartoon and not",
  "a stylised poster. Real skin, real fabric, real studio light.",

  "Place the person from IMAGE 1 on the LEFT and the person from IMAGE 2 on",
  "the RIGHT, both facing the camera, standing upright shoulder to shoulder at",
  "the same scale, the same height in frame and on the same ground line.",

  "DO NOT REDRAW EITHER PERSON. This is the most important instruction.",
  "Each face must remain recognisably THAT person: the same eyes, the same",
  "nose, the same mouth, the same jaw and cheekbones, the same eyebrows, the",
  "same expression, the same skin tone and the same hair. Copy each face from",
  "its source image rather than generating a new one that resembles it.",
  "Keep the visible skin texture and pores. Do NOT smooth, retouch, airbrush",
  "or beautify either face. Keep each person's build, pose and folded arms.",

  "KEEP EACH GARMENT EXACTLY AS IT IS: the same white top, the same cut, the",
  "same neckline and the same sleeve length for each of them — theirs differ",
  "and must stay different. If either wears a headscarf, keep it exactly.",

  "Both shirts are plain white and must stay completely blank. Add no logo,",
  "no badge, no crest, no number, no slogan and no text anywhere in the image.",

  "Give the whole picture one continuous, solid, deep electric blue studio",
  "background, hex #0000FF — one flat colour, no gradient, no texture, no",
  "vignette and no visible seam between them. Light both people identically.",
].join(" ");
