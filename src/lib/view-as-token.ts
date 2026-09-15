// The "view as" preview token, as pure as it can be so its refusal rules are
// testable without a database or cookies.
//
// An admin may look at the whole app through another account's eyes — the same
// menus, the same screens, the same redirects — without signing in with that
// account. The token is what makes that survivable: it names the account being
// previewed, carries its own expiry, and is signed, so a forged or stale
// cookie simply reads as "no preview" rather than as somebody else's identity.

import crypto from "node:crypto";

export const VIEW_AS_COOKIE = "podium_view_as";

/** A preview is a look, not a session: it dies on its own after an hour. */
export const VIEW_AS_MAX_AGE = 3_600;

/**
 * `userId.expiry.signature` — the id rides in the open (it is not a secret,
 * only the signature is) so a stale token can be read far enough to be
 * rejected without touching the database.
 */
export function signViewAs(userId: string, expiresAt: number, secret: string): string {
  const payload = `${userId}.${expiresAt}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * Returns the previewed account's id, or null for anything it does not like:
 * a wrong signature, an expired one, a shape it did not cut itself. Every
 * refusal looks the same, so nothing about the failure is worth probing.
 */
export function verifyViewAs(
  token: string | undefined | null,
  secret: string,
  now: number = Date.now()
): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiry, signature] = parts;
  if (!userId || !expiry || !signature) return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${userId}.${expiry}`)
    .digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || now >= expiresAt) return null;

  return userId;
}
