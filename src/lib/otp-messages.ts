// ─────────────────────────────────────────────────────────────────────────────
// WHAT A CODE FORM SAYS WHEN A CODE IS REFUSED — one wording for every door
// (sign-up, /verify, the athlete door, "verify this email").
//
// The server names the refusal (auth-shared.ts › AUTH_ERRORS); each one a
// person can act on differently gets its own sentence, and a refusal that
// lasts says for how long, from the server's own count. A wrong code and an
// unknown address share one answer on purpose.
// ─────────────────────────────────────────────────────────────────────────────

type T = (key: string, vars?: Record<string, string | number>) => string;

/** "40 s", "5 min" — a wait, rounded up to what a person can act on. */
export function waitLabel(seconds: number, t: T): string {
  const whole = Math.max(1, Math.ceil(seconds));
  return whole < 60 ? t("{seconds} s", { seconds: whole }) : t("{minutes} min", { minutes: Math.ceil(whole / 60) });
}

/** The seconds carried by "TOO_MANY_ATTEMPTS:<seconds>", if any. */
export function retryAfterOf(error: string | null | undefined): number | null {
  const match = /^TOO_MANY_ATTEMPTS:(\d+)$/.exec(error ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * The sentence for a refused code. `CODE_REFUSED` (a right code sent to an
 * address the account no longer has) is not here: the forms show their own
 * notice for it, with the way to get a new code.
 */
export function codeErrorMessage(error: string | null | undefined, t: T): string {
  if (error?.startsWith("TOO_MANY_ATTEMPTS")) {
    const seconds = retryAfterOf(error);
    return seconds
      ? t("Too many sign-in attempts. Try again in {wait}.", { wait: waitLabel(seconds, t) })
      : t("Too many sign-in attempts. Try again in a few minutes.");
  }
  switch (error) {
    case "CODE_SUPERSEDED":
      return t("A newer code was sent after this one. Use the code from the most recent email.");
    case "CODE_EXPIRED":
      return t("This code has expired or was already used. Ask for a new code.");
    case "CODE_LOCKED":
      return t("Too many incorrect codes were typed for this one. Ask for a new code.");
    default:
      return t("That code is not correct. Check the most recent email we sent, or ask for a new code.");
  }
}

/** A code was sent (or asked for) too recently: the last one is still the one to use. */
export function resendWaitMessage(seconds: number, t: T): string {
  return t("A code was sent a moment ago and still works. You can ask for another in {wait}.", { wait: waitLabel(seconds, t) });
}

/** Too many codes asked for: nothing more is sent until the window ends. */
export function sendLimitMessage(seconds: number | null | undefined, t: T): string {
  return seconds
    ? t("Too many codes were asked for. Try again in {wait}.", { wait: waitLabel(seconds, t) })
    : t("Too many requests. Wait a few minutes and try again.");
}
