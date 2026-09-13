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

export type TeamStatus = "refunded" | "awaiting_payment" | "registered" | "submitted";

export type TeamStatusFacts = {
  paymentStatus: PaymentStatus;
  submitted: boolean;
};

/**
 * The single word for a team's state.
 *
 * The order matters. A refund is the end of the story whatever else happened,
 * so it is read first — a refunded team with a score on it is refunded, not
 * submitted, and must not be presented as a live entry.
 *
 * Payment comes before the score because an unpaid team is not on the board at
 * all: showing SUBMITTED for one would say it is competing when it is not.
 */
export function teamStatus(team: TeamStatusFacts): TeamStatus {
  if (team.paymentStatus === "refunded") return "refunded";
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
    case "refunded":
      return "Refunded";
  }
}

/**
 * Whether this team counts as competing — paid, not refunded.
 *
 * The board already filters on submitted scores; this is the earlier question,
 * asked by the registration screens: is this a real entry yet?
 */
export const isCompeting = (team: TeamStatusFacts) =>
  team.paymentStatus === "paid";
