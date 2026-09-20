import "server-only";

import crypto from "node:crypto";

import bcrypt from "bcryptjs";

import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";

// Every secret used here stays on the server. Nothing in this module may be
// imported from a client component — `server-only` makes that a build error
// rather than a leak.

const OTP_SECRET = process.env.OTP_SECRET || process.env.NEXTAUTH_SECRET;
const DEVICE_SECRET = process.env.DEVICE_FINGERPRINT_SECRET || process.env.NEXTAUTH_SECRET;

if (!OTP_SECRET) {
  throw new Error("OTP_SECRET or NEXTAUTH_SECRET is required");
}
if (!DEVICE_SECRET) {
  throw new Error("DEVICE_FINGERPRINT_SECRET or NEXTAUTH_SECRET is required");
}

export function normalizeEmail(email: string) {
  return (email || "").trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** The one BFT MENA address that is always promoted to admin, from the env. */
export function isBootstrapAdminEmail(email: string) {
  const configured = normalizeEmail(process.env.DEFAULT_ADMIN_EMAIL || "");
  if (!configured) return false;
  return normalizeEmail(email) === configured;
}

export function generateOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** OTP codes and emailed tokens are only ever stored as an HMAC. */
export function hashSecret(value: string) {
  return crypto.createHmac("sha256", OTP_SECRET as string).update(value).digest("hex");
}

export function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function hashDeviceFingerprint(raw: string) {
  if (!raw) return "";
  return crypto.createHmac("sha256", DEVICE_SECRET as string).update(raw).digest("hex");
}

export function getIpFromHeaders(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return headers.get("x-real-ip") || null;
}

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

export function checkPasswordStrength(password: string): PasswordCheck {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: "PASSWORD_TOO_SHORT" };
  }
  if (!/\d/.test(password)) return { ok: false, reason: "PASSWORD_NEEDS_NUMBER" };
  if (!/[a-z]/.test(password)) return { ok: false, reason: "PASSWORD_NEEDS_LOWER" };
  if (!/[A-Z]/.test(password)) return { ok: false, reason: "PASSWORD_NEEDS_UPPER" };
  return { ok: true };
}

/** Constant-time compare for anything an attacker can submit repeatedly. */
export function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * The absolute origin for links we email. Derived from configuration first so a
 * forged Host header can never redirect a reset link to an attacker's domain.
 */
export function getBaseUrl(req?: Request) {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  if (req) {
    const host = req.headers.get("host") || "";
    if (host) return `${host.includes("localhost") ? "http" : "https"}://${host}`;
  }
  return "http://localhost:3000";
}
