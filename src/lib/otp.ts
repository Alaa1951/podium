import "server-only";

import type { OtpPurpose } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { consumeLoginCode, type ProofResult, type ProvenUser } from "@/lib/auth-proof";
import { prisma } from "@/lib/prisma";
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
  return consumeLoginCode({
    db: prisma,
    userId: params.userId,
    code: params.code,
    purpose: params.purpose,
    maxAttempts: MAX_ATTEMPTS,
    onProven: params.onProven,
  });
}

export async function canResendOtp(params: { userId: string; purpose: OtpPurpose }) {
  const latest = await prisma.otpChallenge.findFirst({
    where: { userId: params.userId, purpose: params.purpose },
    orderBy: { createdAt: "desc" },
  });

  if (!latest) return { allowed: true, cooldownSeconds: 0 };

  const elapsed = (Date.now() - latest.createdAt.getTime()) / 1000;
  if (elapsed < RESEND_COOLDOWN_SECONDS) {
    return { allowed: false, cooldownSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed) };
  }

  return { allowed: true, cooldownSeconds: 0 };
}
