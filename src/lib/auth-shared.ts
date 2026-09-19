import "server-only";

import type { Role, UserStatus } from "@/generated/prisma/enums";
import { sendOtpEmail, sendSecurityAlertEmail } from "@/lib/email";
import { createOtpChallenge, getOtpConfig } from "@/lib/otp";
import { hashDeviceFingerprint } from "@/lib/security";
import { logLoginEvent } from "@/lib/trusted-device";

// The pieces every way in needs: what a device looks like, where a request
// came from, what a session user is, and how a device is challenged. Shared so
// that adding a provider cannot quietly change what any of those mean.

// ─────────────────────────────────────────────────────────────────────────────
// One sign-in for everyone.
//
// There is no role picker: a person types their email and password, and the
// database decides whether they are BFT MENA, a studio, or a member. Accounts
// are never self-created — BFT MENA adds studios, a studio adds its members —
// so an unknown email simply cannot sign in.
//
// Every unrecognised device is challenged with a six-digit code by email before
// a session exists. Nothing in this file ever reaches the browser.
// ─────────────────────────────────────────────────────────────────────────────

export const AUTH_ERRORS = {
  otpRequired: "OTP_REQUIRED",
  accountDisabled: "ACCOUNT_DISABLED",
  notActivated: "ACCOUNT_NOT_ACTIVATED",
  tooManyAttempts: "TOO_MANY_ATTEMPTS",
} as const;

export type DevicePayload = {
  deviceFingerprint: string;
  deviceLabel?: string;
  browser?: string;
  os?: string;
  deviceType?: string;
  trustThisDevice: boolean;
};

export type RawCredentials = Record<string, string | undefined> | undefined;

export function parseDevice(credentials: RawCredentials): DevicePayload {
  return {
    deviceFingerprint: hashDeviceFingerprint(credentials?.deviceFingerprint || ""),
    deviceLabel: credentials?.deviceLabel,
    browser: credentials?.browser,
    os: credentials?.os,
    deviceType: credentials?.deviceType,
    trustThisDevice: credentials?.trustThisDevice === "true",
  };
}

export type ReqLike = { headers?: Record<string, string | string[] | undefined> } | undefined;

export function ipFromReq(req: ReqLike) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  const real = req?.headers?.["x-real-ip"];
  const raw = forwarded ? String(forwarded).split(",")[0]?.trim() : String(real || "");
  return raw && raw !== "undefined" ? raw : null;
}

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: UserStatus;
  studioId: string | null;
  locale: string;
};

export function toSessionUser(user: {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: UserStatus;
  studioId: string | null;
  locale: string;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    studioId: user.studioId,
    locale: user.locale,
  };
}

export async function challengeDevice(params: {
  userId: string;
  email: string;
  deviceFingerprint: string;
  ip: string | null;
  suspicious: boolean;
  device: DevicePayload;
}) {
  const { code } = await createOtpChallenge({
    userId: params.userId,
    purpose: "login",
    deviceFingerprint: params.deviceFingerprint || null,
    ip: params.ip,
  });

  await sendOtpEmail({
    email: params.email,
    code,
    ttlMinutes: getOtpConfig().ttlMinutes,
  });

  await logLoginEvent({
    userId: params.userId,
    eventType: "OTP_SENT",
    deviceFingerprint: params.deviceFingerprint,
    browser: params.device.browser,
    os: params.device.os,
    ip: params.ip,
    isSuspicious: params.suspicious,
  });

  if (params.suspicious) {
    await sendSecurityAlertEmail({
      email: params.email,
      subject: "Unusual sign-in activity",
      details: [
        `Browser: ${params.device.browser || "Unknown"}`,
        `Device: ${params.device.deviceLabel || "Unknown"}`,
        `Time: ${new Date().toISOString()}`,
      ],
    });
  }
}

