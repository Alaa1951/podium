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
