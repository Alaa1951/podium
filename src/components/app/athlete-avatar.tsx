import { athletePhoto } from "@/lib/athlete-photo";

// ─────────────────────────────────────────────────────────────────────────────
// A FACE, SMALL.
//
// The generated portraits are waist-up: head, shoulders and folded arms. At
// thumbnail size all of that shrinks to an unreadable smudge, so this crops to
// the head the way every address book and messenger does — a square of the
// upper frame, not the whole picture scaled down.
//
// The crop is done by `object-position`, not by storing a second cropped file.
// One image serves both the rig screen, where the whole portrait is the point,
// and this, where only the face is.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How far down the portrait the face sits.
 *
 * The prompt fixes the framing — waist up, centred, squarely facing the camera
 * — so the head lands in a predictable band near the top. 22% down puts the
 * eyes slightly above centre, which is where a portrait wants them.
 */
const FACE_Y = "22%";

export function AthleteAvatar({
  photoPath,
  name,
  size = 34,
}: {
  photoPath: string | null | undefined;
  /** For the alt text, so a screen reader hears who this is. */
  name: string;
  size?: number;
}) {
  return (
    // A fixed-size thumbnail of a path we already serve: the optimiser adds
    // a request path to go wrong and buys nothing at 34px.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={athletePhoto(photoPath)}
      alt={name}
      width={size}
      height={size}
      className="athlete-avatar"
      style={{ width: size, height: size, objectPosition: `50% ${FACE_Y}` }}
    />
  );
}
