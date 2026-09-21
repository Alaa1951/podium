

import path from "node:path";

import sharp from "sharp";

// ─────────────────────────────────────────────────────────────────────────────
// THE MARK, AS AN IMAGE TO SEND.
//
// The image model is SHOWN the logo rather than told about it: this builds the
// lockup once from the real files in `public/brand/`, and it goes to the API
// as a second input image beside the athlete's photo.
//
// Describing it was tried first and failed three ways — a generic bold italic
// instead of the wordmark, a lighter blue than the #0000FF it was handed, and
// on one pass the model deleted the mark and wrote "PODIUM / GET REAL", words
// that appear nowhere in this project. `docs/brand.md` says the mark is never
// redrawn; a model asked to draw one has no way to honour that. Handing it the
// artwork is the closest thing to showing it what "exactly this" means.
// ─────────────────────────────────────────────────────────────────────────────

const BRAND_DIR = path.join(process.cwd(), "public", "brand");

/** Cached: the lockup is the same for every portrait ever made. */
let lockup: { buffer: Buffer; width: number; height: number } | null = null;

/** The artwork to send alongside a photo. PNG, transparent, brand colours. */
export async function brandLockupPng(): Promise<Buffer> {
  return (await buildLockup()).buffer;
}

/**
 * The two marks, stacked, on a transparent ground.
 *
 * The PODIUM wordmark is cropped above its rule, dropping "SERIES #1" — that
 * belongs to one competition and this shirt does not. The BFT MENA mark goes
 * underneath at the size it reads at, not at matching width: it is a squarer
 * shape and matching widths would make it tower over the wordmark.
 */
async function buildLockup(): Promise<{ buffer: Buffer; width: number; height: number }> {
  if (lockup) return lockup;

  const WIDTH = 1200;

  const podium = await sharp(path.join(BRAND_DIR, "podium-dark-on-light.png"))
    // Above the rule: the wordmark alone.
    .extract({ left: 0, top: 0, width: 6315, height: 1270 })
    .trim()
    .resize({ width: WIDTH })
    .toBuffer();
  const podiumMeta = await sharp(podium).metadata();

  const bft = await sharp(path.join(BRAND_DIR, "bft-dark-on-light.png"))
    .trim()
    .resize({ width: Math.round(WIDTH * 0.36) })
    .toBuffer();
  const bftMeta = await sharp(bft).metadata();

  const gap = Math.round(podiumMeta.height! * 0.45);
  const height = podiumMeta.height! + gap + bftMeta.height!;

  const buffer = await sharp({
    create: { width: WIDTH, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: podium, left: 0, top: 0 },
      { input: bft, left: Math.round((WIDTH - bftMeta.width!) / 2), top: podiumMeta.height! + gap },
    ])
    .png()
    .toBuffer();

  lockup = { buffer, width: WIDTH, height };
  return lockup;
}

/**
 * How wide the print sits, as a fraction of the picture's width.
 *
 * Small. Earlier passes tried a quarter of the frame, which read as a sponsor
 * panel, and then a sixth, which still drew the eye before the face did. At
 * this size it reads as what it is — a mark on a shirt, not the subject of
 * the photograph — and the flatness of a composited logo stops being obvious.
 */
const MARK_WIDTH = 0.075;

/**
 * Where its centre sits on a single portrait: the middle of the chest.
 *
 * A crest belongs on the left of a real shirt, and that was tried. Composited
 * rather than woven, it sat flat against a curving body and the offset made
 * that plain. Centred, it lands where the fabric is flattest and squarest to
 * the camera, and the eye stops reading it as applied.
 */
const SOLO_X = 0.5;
const SOLO_Y = 0.5;

/**
 * And on a team photo, where two people stand side by side.
 *
 * The composite prompt pins the arrangement — image 1 left, image 2 right,
 * same scale, same height, shoulder to shoulder — so both chests land in a
 * narrow band. These are the centres of that band, not a guess per picture.
 */
const TEAM_LEFT_X = 0.29;
const TEAM_RIGHT_X = 0.685;
const TEAM_Y = 0.56;

/** Scale the lockup and soften it, so it reads as ink rather than a sticker. */
async function inkAt(width: number): Promise<{ buffer: Buffer; height: number }> {
  const mark = await buildLockup();
  const height = Math.round((width / mark.width) * mark.height);
  const buffer = await sharp(mark.buffer)
    .resize({ width })
    // sharp's composite has no opacity option, so the alpha carries it.
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff" fill-opacity="0.94"/></svg>`
        ),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  return { buffer, height };
}

/**
 * Print the real mark onto a generated picture, at one or more chests.
 *
 * Returns the original bytes if anything goes wrong: a portrait without a
 * crest is still a portrait, and losing one to a compositing error would be
 * the worse outcome.
 */
async function stamp(image: Buffer, spots: { x: number; y: number }[]): Promise<Buffer> {
  try {
    const meta = await sharp(image).metadata();
    if (!meta.width || !meta.height) return image;

    const width = Math.round(meta.width * MARK_WIDTH);
    const ink = await inkAt(width);

    return await sharp(image)
      .composite(
        spots.map((spot) => ({
          input: ink.buffer,
          left: Math.round(meta.width! * spot.x - width / 2),
          top: Math.round(meta.height! * spot.y - ink.height / 2),
        }))
      )
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
  } catch {
    return image;
  }
}

/** One person, one crest. */
export function applyChestMark(image: Buffer): Promise<Buffer> {
  return stamp(image, [{ x: SOLO_X, y: SOLO_Y }]);
}

/** Two people side by side, a crest each. */
export function applyTeamMarks(image: Buffer): Promise<Buffer> {
  return stamp(image, [
    { x: TEAM_LEFT_X, y: TEAM_Y },
    { x: TEAM_RIGHT_X, y: TEAM_Y },
  ]);
}
