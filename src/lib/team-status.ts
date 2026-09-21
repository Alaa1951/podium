import type { PaymentStatus } from "@/generated/prisma/enums";

// ─────────────────────────────────────────────────────────────────────────────
// ONE STATUS PER TEAM.
//
// The BFT manual gives a studio a single STATUS column that walks REGISTERED →
// SUBMITTED, and that is what a person filling in scores actually wants to read:
// one word per row, not a payment badge beside a score badge that they have to
// combine in their head.
//
// It is derived, never stored. A fourth column in the database would be a
// fourth thing that can drift out of step with the three facts it summarises —
// and the one that drifted would be the one on screen.
//
// Pure and dependency-free, so it is tested exhaustively in team-status.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type TeamStatus =
  | "refunded"
  | "waiting_list"
  | "awaiting_payment"
  | "registered"
  | "submitted";

export type TeamStatusFacts = {
  paymentStatus: PaymentStatus;
  submitted: boolean;
  /**
   * Set when the entry arrived after registration closed.
   *
   * REQUIRED, not optional, and that is the whole point. It was optional for
   * one release "so existing callers keep working", and a caller promptly
   * stopped passing it: the registrations table carried its own `waitlisted`
   * boolean for the buttons and handed this function an object with no
   * `waitlistedAt` at all. TypeScript had nothing to say, the value read as
   * undefined, and a paid team on the waiting list was labelled REGISTERED on
   * the one screen staff use to decide who is in — the exact lie the waiting
   * list exists to prevent.
   *
   * Making it required turns that class of mistake into a compile error. A
   * caller that genuinely has no such fact passes `null` and says so.
   */
  waitlistedAt: Date | null;
};

/**
 * The single word for a team's state.
 *
 * The order matters. A refund is the end of the story whatever else happened,
 * so it is read first — a refunded team with a score on it is refunded, not
 * submitted, and must not be presented as a live entry.
 *
 * THE WAITING LIST COMES NEXT, ahead of payment, and that ordering is the
 * rule BFT MENA asked for: money does not buy a place. Somebody on the list
 * who has paid must keep reading WAITING LIST — if payment were checked first
 * they would see REGISTERED, believe they were in, and turn up to a
 * competition that has no station for them.
 *
 * Payment comes before the score because an unpaid team is not on the board at
 * all: showing SUBMITTED for one would say it is competing when it is not.
 */
export function teamStatus(team: TeamStatusFacts): TeamStatus {
  if (team.paymentStatus === "refunded") return "refunded";
  if (team.waitlistedAt) return "waiting_list";
  if (team.paymentStatus !== "paid") return "awaiting_payment";
  return team.submitted ? "submitted" : "registered";
}

/**
 * The badge class for a status, so every table shows the same state the same
 * colour. The strings are the ones already in ui.css — nothing new is invented
 * here.
 */
export function teamStatusTone(status: TeamStatus): string {
  switch (status) {
    case "submitted":
      return "badge-ok";
    case "registered":
      return "badge-blue";
    case "awaiting_payment":
      return "badge-warn";
    // Not a warning and not a failure — nothing has gone wrong, they queued.
    case "waiting_list":
      return "badge-neutral";
    case "refunded":
      return "badge-neutral";
  }
}

/**
 * The English label, as the manual writes it. It is passed through the
 * translator at the call site rather than here, so this file stays pure and the
 * Arabic strings live with all the others.
 */
export function teamStatusLabel(status: TeamStatus): string {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "registered":
      return "Registered";
    case "awaiting_payment":
      return "Awaiting payment";
    case "waiting_list":
      return "Waiting list";
    case "refunded":
      return "Refunded";
  }
}

/**
 * Whether this team counts as competing — paid, and holding a place.
 *
 * THE ONE GATE. Every screen, report and login check that used to write
 * `paymentStatus === "paid"` inline now asks this instead, because the answer
 * has stopped being about payment alone: a team on the waiting list can be
 * fully paid and is still not competing. Four copies of that comparison
 * would have meant four places to remember, and the one that was forgotten
 * would have put somebody on the board who has no station.
 *
 * It is one expression on purpose — a rule written once is a rule that cannot
 * be half-changed.
 */
export const isCompeting = (team: Pick<TeamStatusFacts, "paymentStatus" | "waitlistedAt">) =>
  team.paymentStatus === "paid" && !team.waitlistedAt;
