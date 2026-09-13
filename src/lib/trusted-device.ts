import "server-only";

import { prisma } from "@/lib/prisma";

const TRUST_DAYS = Number(process.env.DEVICE_TRUST_DAYS || 30);

function trustExpiry() {
  return new Date(Date.now() + TRUST_DAYS * 24 * 3_600_000);
}

export async function getTrustedDevice(params: { userId: string; deviceFingerprint: string }) {
  if (!params.deviceFingerprint) return null;
  return prisma.trustedDevice.findFirst({
    where: {
      userId: params.userId,
      deviceFingerprint: params.deviceFingerprint,
      isTrusted: true,
      isRevoked: false,
      trustExpiresAt: { gt: new Date() },
    },
  });
}

export async function markTrustedDeviceUsed(params: {
  userId: string;
  deviceFingerprint: string;
  ip?: string | null;
}) {
  if (!params.deviceFingerprint) return;
  await prisma.trustedDevice.updateMany({
    where: {
      userId: params.userId,
      deviceFingerprint: params.deviceFingerprint,
      isRevoked: false,
    },
    data: { lastUsedAt: new Date(), ...(params.ip ? { lastIp: params.ip } : {}) },
  });
}

export async function upsertTrustedDevice(params: {
  userId: string;
  deviceFingerprint: string;
  deviceLabel?: string | null;
  browser?: string | null;
  os?: string | null;
  deviceType?: string | null;
  ip?: string | null;
}) {
  if (!params.deviceFingerprint) return null;
  const expires = trustExpiry();

  return prisma.trustedDevice.upsert({
    where: {
      userId_deviceFingerprint: {
        userId: params.userId,
        deviceFingerprint: params.deviceFingerprint,
      },
    },
    create: {
      userId: params.userId,
      deviceFingerprint: params.deviceFingerprint,
      deviceLabel: params.deviceLabel || null,
      browser: params.browser || null,
      os: params.os || null,
      deviceType: params.deviceType || null,
      trustExpiresAt: expires,
      isTrusted: true,
      lastIp: params.ip || null,
    },
    update: {
      deviceLabel: params.deviceLabel || undefined,
      browser: params.browser || undefined,
      os: params.os || undefined,
      deviceType: params.deviceType || undefined,
      lastUsedAt: new Date(),
      trustCreatedAt: new Date(),
      trustExpiresAt: expires,
      isTrusted: true,
      isRevoked: false,
      revokedAt: null,
      revokeReason: null,
      lastIp: params.ip || undefined,
    },
  });
}

/** Every trusted device is dropped whenever the password changes. */
export async function revokeTrustedDevices(params: { userId: string; reason: string }) {
  await prisma.trustedDevice.updateMany({
    where: { userId: params.userId, isRevoked: false },
    data: {
      isTrusted: false,
      isRevoked: true,
      revokedAt: new Date(),
      revokeReason: params.reason,
    },
  });
}

const FAILURE_WINDOW_MINUTES = Number(process.env.SUSPICIOUS_FAILURE_WINDOW_MINUTES || 15);
const MAX_LOGIN_FAILURES = Number(process.env.SUSPICIOUS_MAX_LOGIN_FAILURES || 5);
const MAX_OTP_FAILURES = Number(process.env.SUSPICIOUS_MAX_OTP_FAILURES || 5);

/** Recent failures against this account force a code even on a trusted device. */
export async function isSuspiciousLogin(params: { userId: string }) {
  const since = new Date(Date.now() - FAILURE_WINDOW_MINUTES * 60_000);
  const [loginFailures, otpFailures] = await Promise.all([
    prisma.loginEvent.count({
      where: { userId: params.userId, eventType: "LOGIN_FAILED", createdAt: { gt: since } },
    }),
    prisma.loginEvent.count({
      where: { userId: params.userId, eventType: "OTP_FAILED", createdAt: { gt: since } },
    }),
  ]);

  return loginFailures >= MAX_LOGIN_FAILURES || otpFailures >= MAX_OTP_FAILURES;
}

export async function logLoginEvent(params: {
  userId: string;
  eventType: string;
  deviceFingerprint?: string | null;
  browser?: string | null;
  os?: string | null;
  ip?: string | null;
  isTrustedDevice?: boolean;
  isSuspicious?: boolean;
}) {
  await prisma.loginEvent.create({
    data: {
      userId: params.userId,
      eventType: params.eventType,
      deviceFingerprint: params.deviceFingerprint || null,
      browser: params.browser || null,
      os: params.os || null,
      ip: params.ip || null,
      isTrustedDevice: params.isTrustedDevice ?? false,
      isSuspicious: params.isSuspicious ?? false,
    },
  });
}
