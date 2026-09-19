/**
 * Signed in until sign-out, or until this long passes without opening the app
 * or site. Phones expect to stay signed in; a disabled or archived account
 * still loses access within the five-minute token refresh (auth.ts).
 */
export const SESSION_IDLE_MS = 30 * 24 * 3_600_000;

/**
 * The deadline moves forward each time the session is read and re-issued
 * (the app calls /api/auth/session on every open and resume). One that has
 * already passed stays passed: an expired session is never revived.
 */
export function nextSessionDeadline(current: unknown, now = Date.now()): number {
  if (typeof current === "number" && now > current) return current;
  return now + SESSION_IDLE_MS;
}
