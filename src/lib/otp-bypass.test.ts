import { describe, expect, it } from "vitest";

import { otpDevBypassEnabled } from "@/lib/otp-bypass";

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
