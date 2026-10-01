// ─────────────────────────────────────────────────────────────────────────────
// WHETHER AN ATHLETE'S WAIVER HOLDS.
//
// The athlete's own signature of the competition's ACTIVE release, and
// nothing else. The signature is the athlete's consent for themselves: it
// covers them whatever category or level their team moves to afterwards, and
// nobody else's signature covers them. A signature of an earlier version is
// kept — history is never deleted — but once BFT MENA requires a new version
// the athlete signs that one ("requires re-signing").
//
// Pure.
// ─────────────────────────────────────────────────────────────────────────────

export type WaiverState =
  /** This competition requires no waiver. */
  | "not_required"
  | "signed"
  /** Never signed. */
  | "pending"
  /** Signed an earlier version; the current one is not signed yet. */
  | "resign"
  /** The seat has no PODIUM account yet — the athlete signs in, then signs. */
  | "no_account";

export type AcceptanceFact = { releaseId: string };

export function waiverState(input: {
  release: { id: string } | null;
  userId: string | null;
  acceptances: readonly AcceptanceFact[];
}): WaiverState {
  if (!input.release) return "not_required";
  if (!input.userId) return "no_account";
  if (input.acceptances.some((one) => one.releaseId === input.release!.id)) return "signed";
  return input.acceptances.length ? "resign" : "pending";
}

export const waiverSatisfied = (state: WaiverState) => state === "not_required" || state === "signed";

/** "Anna  Maria " → "Anna Maria"; empty when there is no letter in any script. */
export function normaliseSignature(raw: string): string {
  const name = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
  return /\p{L}/u.test(name) ? name : "";
}
