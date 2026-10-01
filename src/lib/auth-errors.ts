import type { ProofResult } from "@/lib/auth-proof";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT A SIGN-IN DOOR THROWS — the names the forms read (otp-messages.ts).
// Pure, so every door and every test uses the same ones.
// ─────────────────────────────────────────────────────────────────────────────

export const AUTH_ERRORS = {
  otpRequired: "OTP_REQUIRED",
  accountDisabled: "ACCOUNT_DISABLED",
  notActivated: "ACCOUNT_NOT_ACTIVATED",
  /** Thrown as "TOO_MANY_ATTEMPTS:<seconds>" — how long the refusal lasts. */
  tooManyAttempts: "TOO_MANY_ATTEMPTS",
  /** The right code of an earlier email: a newer one replaced it. */
  codeSuperseded: "CODE_SUPERSEDED",
  /** The right code, expired or already used. */
  codeExpired: "CODE_EXPIRED",
  /** The right code, locked by too many wrong ones typed before it. */
  codeLocked: "CODE_LOCKED",
  /**
   * The code was right but cannot be used: it was sent to an address the
   * account no longer has, or it predates recipient records. The person
   * asks for a new one (competitor-login-form.tsx › refused screen).
   */
  codeRefused: "CODE_REFUSED",
} as const;

/**
 * Why a code was refused, for the form to say — only where the answer needs
 * a REAL code from that mailbox (auth-proof.ts › consumeLoginCode):
 *
 *   right code, sent to an address the account no longer has
 *     (or before recipients were recorded)          CODE_REFUSED
 *   right code of an earlier email, since replaced  CODE_SUPERSEDED
 *   right code, expired or already used             CODE_EXPIRED
 *   right code, locked by wrong ones typed first    CODE_LOCKED
 *
 * A wrong code stays silent (`null`) — exactly what an address with no
 * account gets — so none of this tells a stranger who is registered.
 */
export function refuseWithReason(verification: ProofResult): void {
  if (verification.ok) return;
  switch (verification.reason) {
    case "no_recipient":
    case "address_changed":
      throw new Error(AUTH_ERRORS.codeRefused);
    case "superseded":
      throw new Error(AUTH_ERRORS.codeSuperseded);
    case "expired":
      throw new Error(AUTH_ERRORS.codeExpired);
    case "attempts":
      throw new Error(AUTH_ERRORS.codeLocked);
  }
}

/** Throw the rate-limit refusal with how long it lasts. */
export function tooManyAttempts(retryAfter: number): Error {
  return new Error(`${AUTH_ERRORS.tooManyAttempts}:${retryAfter}`);
}
