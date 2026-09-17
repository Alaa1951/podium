// LOCAL TESTING ONLY.
//
// The OTP email step is skipped for staff sign-ins only when BOTH are true:
// the process is not a production build, and the flag is explicitly set in
// the local .env. A production process ignores the flag entirely, whatever
// it says — this function is the single decision, and it is pure so the
// tests can pin it.

export function otpDevBypassEnabled(env: {
  NODE_ENV?: string | undefined;
  OTP_DEV_BYPASS?: string | undefined;
}): boolean {
  return env.NODE_ENV !== "production" && env.OTP_DEV_BYPASS === "true";
}

// A server-side exception for explicitly named password-authenticated staff
// accounts. This never authorizes an OTP-only or competitor sign-in.
export function staffOtpExempt(env: { OTP_EXEMPT_EMAILS?: string }, email: string, role: string): boolean {
  if (role !== "admin" && role !== "studio") return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return (env.OTP_EXEMPT_EMAILS || "").split(",").some((entry) => entry.trim().toLowerCase() === normalized);
}
