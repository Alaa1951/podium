import "server-only";

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { sendSecurityAlertEmail } from "@/lib/email";
import { verifyOtpChallenge } from "@/lib/otp";
import { onAthleteVerified } from "@/lib/partners";
import { otpDevBypassEnabled, staffOtpExempt } from "@/lib/otp-bypass";
import { prisma } from "@/lib/prisma";
import { limitAuthAttempt } from "@/lib/rate-limit";
import { normalizeEmail, verifyPassword } from "@/lib/security";
import {
  getTrustedDevice,
  isSuspiciousLogin,
  logLoginEvent,
  markTrustedDeviceUsed,
  upsertTrustedDevice,
} from "@/lib/trusted-device";
import {
  AUTH_ERRORS,
  challengeDevice,
  ipFromReq,
  parseDevice,
  toSessionUser,
  type ReqLike,
} from "@/lib/auth-shared";

// THE STAFF SIGN-IN, and the competitor's.
//
//   credentials  email + password, then a code unless the device is trusted
//   otp          the second step of that same sign-in
//   competitor   a registered competitor, by code alone — they have no password
//
// One file because they share every helper above and the same threat model;
// splitting them would mean four ways to get `toSessionUser` slightly wrong.

/**
 * LOCAL TESTING ONLY. Doubly locked: a development build AND an explicit
 * .env flag. When on, the emailed code step is skipped — staff sign in with
 * just email + password, and the competitor door accepts any six digits.
 * A production build ignores the flag entirely, whatever .env says.
 * The decision lives in otp-bypass.ts, pinned by its own tests.
 */
const OTP_DEV_BYPASS = otpDevBypassEnabled(process.env);

export const passwordProviders: NextAuthOptions["providers"] = [
  CredentialsProvider({
    id: "credentials",
    name: "PODIUM",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
      deviceFingerprint: { type: "text" },
      deviceLabel: { type: "text" },
      browser: { type: "text" },
      os: { type: "text" },
      deviceType: { type: "text" },
      trustThisDevice: { type: "text" },
    },
    async authorize(credentials, req) {
      const email = normalizeEmail(credentials?.email || "");
      const password = credentials?.password || "";
      const device = parseDevice(credentials);
      const ip = ipFromReq(req as ReqLike);

      if (!email || !password) return null;

      const rate = limitAuthAttempt({ scope: "login", ip, identifier: email, limit: 10 });
      if (!rate.ok) throw new Error(AUTH_ERRORS.tooManyAttempts);

      const user = await prisma.user.findUnique({ where: { email } });

      // An unknown email and a wrong password are indistinguishable to the
      // caller: both simply fail. Nothing here reveals who holds an account.
      if (!user || !user.passwordHash) return null;

      if (user.status === "disabled") throw new Error(AUTH_ERRORS.accountDisabled);
      if (user.status === "invited") throw new Error(AUTH_ERRORS.notActivated);

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        await logLoginEvent({ userId: user.id, eventType: "LOGIN_FAILED", ip });
        return null;
      }

      const suspicious = await isSuspiciousLogin({ userId: user.id });
      const trusted = device.deviceFingerprint
        ? await getTrustedDevice({ userId: user.id, deviceFingerprint: device.deviceFingerprint })
        : null;

      // Evaluate the server-only allowlist after the password has been checked.
      // Never use it in either code-only provider below.
      const exempt = staffOtpExempt({ OTP_EXEMPT_EMAILS: process.env.OTP_EXEMPT_EMAILS }, email, user.role);
      if ((user.forceOtpNextLogin || suspicious || !trusted) && !OTP_DEV_BYPASS && !exempt) {
        await challengeDevice({
          userId: user.id,
          email,
          deviceFingerprint: device.deviceFingerprint,
          ip,
          suspicious,
          device,
        });
        throw new Error(AUTH_ERRORS.otpRequired);
      }

      await markTrustedDeviceUsed({
        userId: user.id,
        deviceFingerprint: device.deviceFingerprint,
        ip,
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), forceOtpNextLogin: false, ...(ip ? { lastIp: ip } : {}) },
      });
      await logLoginEvent({
        userId: user.id,
        eventType: "LOGIN_SUCCESS",
        deviceFingerprint: device.deviceFingerprint,
        browser: device.browser,
        os: device.os,
        ip,
        isTrustedDevice: Boolean(trusted),
      });

      return toSessionUser(user);
    },
  }),

  // Second step of the same sign-in: the emailed code.
  CredentialsProvider({
    id: "otp",
    name: "PODIUM code",
    credentials: {
      email: { type: "email" },
      code: { type: "text" },
      deviceFingerprint: { type: "text" },
      deviceLabel: { type: "text" },
      browser: { type: "text" },
      os: { type: "text" },
      deviceType: { type: "text" },
      trustThisDevice: { type: "text" },
    },
    async authorize(credentials, req) {
      const email = normalizeEmail(credentials?.email || "");
      const code = (credentials?.code || "").trim();
      const device = parseDevice(credentials);
      const ip = ipFromReq(req as ReqLike);

      if (!email || !code) return null;

      const rate = limitAuthAttempt({ scope: "otp", ip, identifier: email, limit: 10 });
      if (!rate.ok) throw new Error(AUTH_ERRORS.tooManyAttempts);

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return null;
      if (user.status === "disabled") throw new Error(AUTH_ERRORS.accountDisabled);
      if (user.status === "invited") throw new Error(AUTH_ERRORS.notActivated);

      const verification = OTP_DEV_BYPASS
        ? { ok: true }
        : await verifyOtpChallenge({ userId: user.id, code, purpose: "login" });
      if (!verification.ok) {
        await logLoginEvent({ userId: user.id, eventType: "OTP_FAILED", ip });
        return null;
      }

      if (device.trustThisDevice && device.deviceFingerprint) {
        await upsertTrustedDevice({
          userId: user.id,
          deviceFingerprint: device.deviceFingerprint,
          deviceLabel: device.deviceLabel || null,
          browser: device.browser || null,
          os: device.os || null,
          deviceType: device.deviceType || null,
          ip,
        });
        await logLoginEvent({
          userId: user.id,
          eventType: "TRUST_CREATED",
          deviceFingerprint: device.deviceFingerprint,
          browser: device.browser,
          os: device.os,
          ip,
          isTrustedDevice: true,
        });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          forceOtpNextLogin: false,
          emailVerified: user.emailVerified ?? new Date(),
          ...(ip ? { lastIp: ip } : {}),
        },
      });
      await logLoginEvent({
        userId: user.id,
        eventType: "OTP_VERIFIED",
        deviceFingerprint: device.deviceFingerprint,
        browser: device.browser,
        os: device.os,
        ip,
        isTrustedDevice: device.trustThisDevice,
      });

      await sendSecurityAlertEmail({
        email: user.email,
        subject: "New device signed in",
        details: [
          `Device: ${device.deviceLabel || "Unknown"}`,
          `Browser: ${device.browser || "Unknown"}`,
          `Time: ${new Date().toISOString()}`,
        ],
      });

      return toSessionUser(user);
    },
  }),

  // ── The competitor's way in ──────────────────────────────────────────────
  // No password, because a registered competitor never had one: they gave an
  // email when they entered and that is the credential. The account is created
  // on the way through, so registering a field of 216 does not create 216
  // dormant logins nobody asked for.
  CredentialsProvider({
    id: "competitor",
    name: "PODIUM competitor",
    credentials: {
      email: { type: "email" },
      code: { type: "text" },
    },
    async authorize(credentials, req) {
      const email = normalizeEmail(credentials?.email || "");
      const code = (credentials?.code || "").trim();
      const ip = ipFromReq(req as ReqLike);

      if (!email || !code) return null;

      const rate = limitAuthAttempt({ scope: "competitor-otp", ip, identifier: email, limit: 10 });
      if (!rate.ok) throw new Error(AUTH_ERRORS.tooManyAttempts);

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return null;
      if (user.status === "disabled") throw new Error(AUTH_ERRORS.accountDisabled);

      const verification = OTP_DEV_BYPASS
        ? { ok: true }
        : await verifyOtpChallenge({ userId: user.id, code, purpose: "login" });
      if (!verification.ok) {
        await logLoginEvent({ userId: user.id, eventType: "OTP_FAILED", ip });
        return null;
      }

      // Signing in this way proves the address, which is the only thing an
      // invitation would have proved.
      await prisma.user.update({
        where: { id: user.id },
        data: {
          status: "active",
          lastLoginAt: new Date(),
          emailVerified: user.emailVerified ?? new Date(),
          ...(ip ? { lastIp: ip } : {}),
        },
      });

      await logLoginEvent({ userId: user.id, eventType: "COMPETITOR_OTP_VERIFIED", ip });

      // An athlete who signed up proves their address for the first time:
      // link their partner, or invite them (partners.ts).
      if (!user.emailVerified && user.signupType === "athlete") {
        await onAthleteVerified(user.id, user.email).catch(() => undefined);
      }

      return toSessionUser({ ...user, status: "active" });
    },
  }),
];
