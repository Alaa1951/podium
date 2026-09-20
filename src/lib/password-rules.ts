/**
 * THE PASSWORD RULE, in one place.
 *
 * `security.ts` holds the check itself, but it is `server-only` — it carries
 * the secrets — so the number cannot be imported from there into a sign-up
 * form. It lives here instead: pure, no secrets, importable from both sides.
 * The form's `minLength`, the hint printed under it and the server's own
 * check all read this one value, so they cannot drift apart.
 *
 * The rule texts are translation keys as well as English copy — the number is
 * a `{n}` placeholder rather than a digit, so changing the minimum never
 * leaves a stale "at least 10" in the Arabic.
 */

/** The shortest password accepted anywhere: sign-up, invitation, reset. */
export const MIN_PASSWORD_LENGTH = 6;

/** The hint under a password field. */
export const PASSWORD_RULES =
  "Use at least {n} characters, with an uppercase letter, a lowercase letter and a number.";

/** The same rule, worded for the sign-up form's tighter column. */
export const PASSWORD_RULES_SHORT =
  "At least {n} characters, with an uppercase letter, a lowercase letter and a number.";

/** What every caller passes to `t()` alongside the two keys above. */
export const PASSWORD_RULE_VALUES = { n: MIN_PASSWORD_LENGTH } as const;
