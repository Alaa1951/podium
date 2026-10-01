import "server-only";

import type { OtpPurpose } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { consumeLoginCode, type ProofResult, type ProvenUser } from "@/lib/auth-proof";
import { prisma } from "@/lib/prisma";
import { cooldownLeft, endCooldown, startCooldown } from "@/lib/rate-limit";
import { generateOtp, hashSecret, normalizeEmail } from "@/lib/security";

const TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60);

export function getOtpConfig() {
  return {
    ttlMinutes: TTL_MINUTES,
    maxAttempts: MAX_ATTEMPTS,
    resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
  };
}

// ── The gap between two codes to one address ────────────────────────────────
// A new code replaces the last one, and email can be slow: a second code sent
// while the first is still on its way is how people end up typing a code
// that no longer works. So one address gets at most one code per
// RESEND_COOLDOWN_SECONDS, from ANY door (sign-up, "send again", password
// sign-in, the athlete door). Every code issued starts the gap; a door asked
// for an address with no account starts it too, so a waiting address looks
// the same whether or not it has an account (rate-limit.ts › cooldowns).

const gapKey = (email: string) => `otp-gap:${normalizeEmail(email)}`;

/** Seconds before another code may go to this address; 0 when one may. */
export function codeGapLeft(email: string): number {
  return cooldownLeft(gapKey(email));
}

/** Start the gap — for an address that got a code, or is answered as if it had. */
export function startCodeGap(email: string): void {
  startCooldown(gapKey(email), RESEND_COOLDOWN_SECONDS * 1000);
}

/**
 * The code the gap was protecting can no longer be used — it signed somebody
 * in, or wrong guesses locked it — so a new one may be asked for at once.
 * Only somebody holding that mailbox's code can bring this about.
 */
function endCodeGap(email: string): void {
  endCooldown(gapKey(email));
}

/**
 * Issues a fresh code and consumes any outstanding challenge for the same
 * purpose, so an older code left in an inbox can never be replayed.
 *
 * `sentTo` is the address the caller is about to email the code to. It is
 * what the code will prove (auth-proof.ts), so it is required — a code with
 * no recipient on record is never accepted.
 */
export async function createOtpChallenge(params: {
  userId: string;
  purpose: OtpPurpose;
  sentTo: string;
  deviceFingerprint?: string | null;
  ip?: string | null;
}) {
  const code = generateOtp();

  await prisma.otpChallenge.updateMany({
    where: { userId: params.userId, purpose: params.purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await prisma.otpChallenge.create({
    data: {
      userId: params.userId,
      codeHash: hashSecret(code),
      purpose: params.purpose,
      expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000),
      deviceFingerprint: params.deviceFingerprint || null,
      ip: params.ip || null,
      sentTo: normalizeEmail(params.sentTo),
    },
  });
  startCodeGap(params.sentTo);

  return { code };
}

export type OtpVerification = ProofResult;

/**
 * Spend a code. Accepted only while the account's email is still the address
 * the code went to; `onProven` runs inside the same transaction (that is
 * where a competitor's seats get linked).
 */
export async function verifyOtpChallenge(params: {
  userId: string;
  code: string;
  purpose: OtpPurpose;
  onProven?: (tx: Prisma.TransactionClient, user: ProvenUser) => Promise<void>;
}): Promise<OtpVerification> {
  const result = await consumeLoginCode({
    db: prisma,
    userId: params.userId,
    code: params.code,
    purpose: params.purpose,
    maxAttempts: MAX_ATTEMPTS,
    onProven: params.onProven,
  });
  if (result.ok) endCodeGap(result.verifiedEmail);
  else if (result.reason === "attempts") {
    const account = await prisma.user.findUnique({ where: { id: params.userId }, select: { email: true } });
    if (account) endCodeGap(account.email);
  }
  return result;
}

/** Whether the newest UNUSED code is older than the cooldown (a used one holds nothing back). */
export async function canResendOtp(params: { userId: string; purpose: OtpPurpose }) {
  const latest = await prisma.otpChallenge.findFirst({
    where: { userId: params.userId, purpose: params.purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!latest) return { allowed: true, cooldownSeconds: 0 };

  const elapsed = (Date.now() - latest.createdAt.getTime()) / 1000;
  if (elapsed < RESEND_COOLDOWN_SECONDS) {
    return { allowed: false, cooldownSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed) };
  }

  return { allowed: true, cooldownSeconds: 0 };
}
