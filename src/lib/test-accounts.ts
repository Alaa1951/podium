// ─────────────────────────────────────────────────────────────────────────────
// TEST ACCOUNTS — one per role, for walking the app as that role.
//
// Which addresses are test accounts is NOT written in this repository, which
// is public: the server's TEST_ACCOUNT_EMAILS lists them, comma-separated.
// For an address on that list:
//
//   • a password sign-in never asks for an emailed code — there is no inbox
//     behind these addresses to read one from;
//   • no email of any kind is ever sent to it (email.ts), so a sign-in, a
//     password reset or an announcement cannot bounce off a mailbox that does
//     not exist.
//
// Everything else is the ordinary account: the password is checked, the
// sign-in is rate-limited and logged, and what the person may do comes from
// their account type and roles exactly as for anyone else. ON/OFF is the
// account's own status — Block it on the Users screen and it cannot sign in.
//
// Pure and dependency-free, so the rule is tested on its own.
// ─────────────────────────────────────────────────────────────────────────────

type Env = { TEST_ACCOUNT_EMAILS?: string | undefined };

/** The configured test addresses, normalised. Empty when none are set. */
export function testAccountEmails(env: Env): Set<string> {
  return new Set(
    (env.TEST_ACCOUNT_EMAILS || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Whether this address is one of the configured test accounts. */
export function isTestAccount(env: Env, email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return testAccountEmails(env).has(normalized);
}
