import "server-only";

import sharp from "sharp";

import { prisma as defaultPrisma } from "@/lib/prisma";
import { checkCaps, releaseDailySlot } from "@/lib/portraits/spend-cap";

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE BYTES, IN AND OUT.
//
// Both directions live here so that `sharp` is imported in exactly one place
// and "what happens to an image" has one file to read.
//
// Plain functions rather than the route handler itself, so the rules that
// matter — who may upload against which seat, whether consent was given, and
// whether there is any budget left — are testable without a request.
//
// WHO MAY UPLOAD: the account proves membership of the TEAM, not ownership of
// one seat, which is the same rule `updateMyTeam` already uses. That is what
// lets somebody upload their partner's photo as well as their own, which is
// what was asked for.
//
// WHAT ARRIVES IS NOT TRUSTED. The browser downscales before sending, but that
// is a courtesy to the network and the bill, not a check: the bytes are decoded
// by `sharp` here, re-encoded, and stripped of metadata. EXIF carries GPS, and
// a photograph taken at somebody's home should not arrive with the coordinates
// of their home attached.
// ─────────────────────────────────────────────────────────────────────────────

type Db = typeof defaultPrisma;

/** Bigger than a phone photo has any need to be, after the browser's pass. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** What the API is given. Larger buys nothing and costs more. */
const MAX_EDGE = 1536;

export type UploadResult =
  | { ok: true; jobId: string }
  | {
      ok: false;
      error:
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "CONSENT_REQUIRED"
        | "NO_IMAGE"
        | "TOO_LARGE"
        | "NOT_AN_IMAGE"
        | "SEAT_LIMIT"
        | "DAILY_CAP"
        | "DISABLED";
    };

export type UploadInput = {
  userId: string;
  competitorId: string;
  consent: boolean;
  bytes: Buffer;
  ip: string | null;
  now: Date;
};

/**
 * Decode, re-encode and strip. Returns null for anything that is not an image.
 *
 * Re-encoding rather than passing the original through is the point: it proves
 * the bytes really are an image, it drops EXIF (and with it any GPS), and it
 * bounds what is sent to a third party and stored.
 */
export async function normalisePhoto(
  bytes: Buffer
): Promise<{ b64: string; mime: string } | null> {
  try {
    const out = await sharp(bytes)
      .rotate() // honour EXIF orientation before the data is thrown away
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    return { b64: out.toString("base64"), mime: "image/jpeg" };
  } catch {
    return null;
  }
}

/**
 * Shrink what the image API returned, before it is stored.
 *
 * MEASURED, not guessed: a real call came back as a 1024x1024 PNG of 1.4MB,
 * which is ~1.9MB once base64'd. Two portraits and a composite is ~5.7MB per
 * team — in the database, and in every nightly mysqldump, for ever. The same
 * picture as JPEG is a fraction of that and no worse on a rig screen at four
 * metres.
 *
 * PNG in, JPEG out. If the encode fails the original is kept rather than the
 * portrait being lost over a size optimisation.
 */
export async function compressForStorage(
  image: { imageB64: string; mimeType: string }
): Promise<{ imageB64: string; mimeType: string }> {
  try {
    const out = await sharp(Buffer.from(image.imageB64, "base64"))
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    return { imageB64: out.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    return image;
  }
}

/**
 * Queue a portrait for one seat.
 *
 * The order of the checks is deliberate: the free ones first, then the one
 * that spends from a shared budget last, so a refused upload never costs
 * anybody else a slot.
 */
export async function queuePortrait(
  input: UploadInput,
  db: Db = defaultPrisma,
  normalise = normalisePhoto
): Promise<UploadResult> {
  // Consent before anything else. A job without it is a bug, not a default,
  // so there must be no path that creates one.
  if (!input.consent) return { ok: false, error: "CONSENT_REQUIRED" };
  if (!input.bytes.length) return { ok: false, error: "NO_IMAGE" };
  if (input.bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: "TOO_LARGE" };

  // The seat must be on a team this account is on. Not "a seat with my
  // userId" — either member may upload for either seat.
  const seat = await db.competitor.findFirst({
    where: {
      id: input.competitorId,
      team: { archivedAt: null, competitors: { some: { userId: input.userId } } },
    },
    select: { id: true },
  });
  if (!seat) return { ok: false, error: "NOT_FOUND" };

  const photo = await normalise(input.bytes);
  if (!photo) return { ok: false, error: "NOT_AN_IMAGE" };

  const caps = await checkCaps(input.competitorId, input.now, db);
  if (!caps.ok) return { ok: false, error: caps.reason };

  try {
    const job = await db.portraitJob.create({
      data: {
        targetKind: "competitor",
        competitorId: seat.id,
        sourceB64: photo.b64,
        sourceMime: photo.mime,
        consentAt: input.now,
        consentIp: input.ip,
        uploadedById: input.userId,
      },
      select: { id: true },
    });
    return { ok: true, jobId: job.id };
  } catch (error) {
    // The slot was taken for a job that never existed; give it back rather
    // than quietly shrinking the day's budget.
    await releaseDailySlot(input.now, db).catch(() => undefined);
    throw error;
  }
}
