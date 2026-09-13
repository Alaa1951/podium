import { afterEach, describe, expect, it, vi } from "vitest";

import { sendOtpEmail } from "@/lib/email";

// PRODUCTION FAIL-CLOSED: a missing SMTP configuration must never downgrade
// to logging secrets like OTP codes. The email is refused, the payload is
// never written to any log, and the caller gets a generic error.

const OTP_PAYLOAD = {
  email: "judge@keysintl.com",
  code: "123456",
  ttlMinutes: 10,
};

function productionEnv() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SMTP_HOST", "");
  vi.stubEnv("EMAIL_SEND_IN_DEV", "");
}

describe("sendMail fail-closed in production", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("refuses to send and never logs the code when SMTP_HOST is missing", async () => {
    productionEnv();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendOtpEmail(OTP_PAYLOAD)).rejects.toThrow("EMAIL_SEND_FAILED");

    const everything = [info, log, warn, error]
      .flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(" ")))
      .join("\n");
    expect(everything).not.toContain("123456");
    expect(everything).toContain("SMTP_HOST is not configured");
  });
});
