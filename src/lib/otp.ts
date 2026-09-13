import "server-only";

import type { OtpPurpose } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { generateOtp, hashSecret, safeEqual } from "@/lib/security";

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
 */
export async function createOtpChallenge(params: {
  userId: string;
  purpose: OtpPurpose;
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
    },
  });

  return { code };
}

export type OtpVerification =
  | { ok: true }
  | { ok: false; reason: "expired" | "attempts" | "invalid" };

export async function verifyOtpChallenge(params: {
  userId: string;
  code: string;
  purpose: OtpPurpose;
}): Promise<OtpVerification> {
  const challenge = await prisma.otpChallenge.findFirst({
    where: {
      userId: params.userId,
      purpose: params.purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) return { ok: false, reason: "expired" };
  if (challenge.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "attempts" };

  if (!safeEqual(challenge.codeHash, hashSecret(params.code))) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "invalid" };
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  return { ok: true };
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
