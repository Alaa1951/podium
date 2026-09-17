import { describe, expect, it } from "vitest";

import { otpDevBypassEnabled, staffOtpExempt } from "@/lib/otp-bypass";

// The bypass must be impossible in production, whatever the environment says.
describe("otpDevBypassEnabled", () => {
  it("can never be active in a production process — even with the flag set", () => {
    expect(otpDevBypassEnabled({ NODE_ENV: "production", OTP_DEV_BYPASS: "true" })).toBe(false);
    expect(otpDevBypassEnabled({ NODE_ENV: "production", OTP_DEV_BYPASS: "1" })).toBe(false);
    expect(otpDevBypassEnabled({ NODE_ENV: "production", OTP_DEV_BYPASS: "yes" })).toBe(false);
  });

  it("stays off outside production unless the flag is explicitly true", () => {
    expect(otpDevBypassEnabled({ NODE_ENV: "development", OTP_DEV_BYPASS: "true" })).toBe(true);
    expect(otpDevBypassEnabled({ NODE_ENV: "development", OTP_DEV_BYPASS: "false" })).toBe(false);
    expect(otpDevBypassEnabled({ NODE_ENV: "development", OTP_DEV_BYPASS: undefined })).toBe(false);
    expect(otpDevBypassEnabled({ NODE_ENV: "test", OTP_DEV_BYPASS: "true" })).toBe(true);
  });
});

describe("staffOtpExempt", () => {
  it("matches only explicitly named staff, including in production", () => {
    const env = { OTP_EXEMPT_EMAILS: " Review@example.com , other@example.com " };
    expect(staffOtpExempt(env, "review@example.com", "admin")).toBe(true);
    expect(staffOtpExempt(env, "OTHER@example.com", "studio")).toBe(true);
    expect(staffOtpExempt(env, "unlisted@example.com", "admin")).toBe(false);
    expect(staffOtpExempt(env, "xreview@example.com", "admin")).toBe(false);
    expect(staffOtpExempt(env, "review@example.com", "competitor")).toBe(false);
    expect(staffOtpExempt(env, "review@example.com", "unknown")).toBe(false);
  });

  it("requires an exact non-empty address; wildcards have no meaning", () => {
    expect(staffOtpExempt({}, "review@example.com", "admin")).toBe(false);
    expect(staffOtpExempt({ OTP_EXEMPT_EMAILS: ", ," }, "", "admin")).toBe(false);
    expect(staffOtpExempt({ OTP_EXEMPT_EMAILS: "*@example.com" }, "review@example.com", "admin")).toBe(false);
  });
});
