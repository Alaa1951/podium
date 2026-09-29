import { isCompeting } from "@/lib/team-status";

// ─────────────────────────────────────────────────────────────────────────────
// WHO REGISTERED A TEAM (plan v7 §4).
//
// The registrant is a PERSON — an email, and once they sign in an account —
// never a seat number. Position 1 is merely where a form put somebody: on
// CRM teams the payer sits at position 2 on some teams, and a pair formed by
// a request puts the acceptor first. So the registrant's seat is found at
// read time: the seat of `registrantUserId`, else the one seat carrying
// `registrantEmail`.
//
//   registrant — one person manages who is on the team.
//   joint      — two independent registrants, equal rights; nobody owns the
//                other's seat.
//   unknown    — nobody has confirmed it. Grants nothing to anybody; BFT MENA
//                sets it.
//
// Pure functions only: safe on the server and in the browser.
// ─────────────────────────────────────────────────────────────────────────────

export type Ownership = "registrant" | "joint" | "unknown";

export type SeatRef = { id: string; userId: string | null; email: string | null };

export type OwnedTeam = {
  ownership: Ownership;
  registrantEmail: string | null;
  registrantUserId: string | null;
  competitors: SeatRef[];
};

const clean = (email: string | null | undefined) => (email ?? "").trim().toLowerCase() || null;

/** The registrant's seat, or null (unknown or joint ownership, or no match). */
export function registrantSeat<T extends SeatRef>(team: Omit<OwnedTeam, "competitors"> & { competitors: T[] }): T | null {
  if (team.ownership !== "registrant") return null;
  if (team.registrantUserId) {
    const byAccount = team.competitors.find((seat) => seat.userId === team.registrantUserId);
    if (byAccount) return byAccount;
  }
  const email = clean(team.registrantEmail);
  if (!email) return null;
  const byEmail = team.competitors.filter((seat) => clean(seat.email) === email);
  return byEmail.length === 1 ? byEmail[0] : null;
}

/**
 * Ownership of a team created or adopted from a CRM contact: the contact is
 * the payer, and when the payer's email is on one of the seats that person
 * registered the team. Anything else is `unknown` — for BFT MENA to confirm.
 */
export function ownershipFromContact(contactEmail: string | null | undefined, seatEmails: (string | null | undefined)[]): {
  ownership: Ownership;
  registrantEmail: string | null;
} {
  const payer = clean(contactEmail);
  const seats = seatEmails.map(clean);
  if (payer && seats.filter((email) => email === payer).length === 1) return { ownership: "registrant", registrantEmail: payer };
  return { ownership: "unknown", registrantEmail: null };
}

/** Two seats — whatever their positions. */
export function isComplete(team: { competitors: readonly unknown[] }): boolean {
  return team.competitors.length === 2;
}

/**
 * A place in the field AND a full pair. Payment facts alone (isCompeting)
 * stay what approval and accounting read; this is what competing needs.
 * Where it applies — board, waves, results — is decision D3b, not yet made.
 */
export function isEligibleToCompete(team: Parameters<typeof isCompeting>[0] & { competitors: readonly unknown[] }): boolean {
  return isCompeting(team) && isComplete(team);
}

/**
 * Athlete-initiated membership changes (replace, fill, leave). OFF unless
 * explicitly turned on — R2a ships the model with this off (plan §12).
 */
export function membershipChangesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ATHLETE_MEMBERSHIP_CHANGES === "on";
}
