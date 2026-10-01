/** What each code form says — one sentence per refusal a person acts on differently. */
import { describe, expect, it } from "vitest";

import { codeErrorMessage, resendWaitMessage, retryAfterOf, sendLimitMessage, waitLabel } from "@/lib/otp-messages";
import { createTranslator } from "@/lib/i18n/dictionary";

const en = createTranslator("en");
const ar = createTranslator("ar");

describe("the words for a refused code", () => {
  it("names each refusal apart", () => {
    const said = ["CODE_SUPERSEDED", "CODE_EXPIRED", "CODE_LOCKED", "TOO_MANY_ATTEMPTS:300", "CredentialsSignin"].map((error) => codeErrorMessage(error, en));
    expect(new Set(said).size).toBe(5);
    expect(said[0]).toContain("newer code");
    expect(said[1]).toContain("expired");
    expect(said[2]).toContain("Too many incorrect codes");
    expect(said[3]).toBe("Too many sign-in attempts. Try again in 5 min.");
  });

  it("a wrong code and an unknown address read the same (NextAuth's plain failure, or nothing)", () => {
    expect(codeErrorMessage("CredentialsSignin", en)).toBe(codeErrorMessage(null, en));
  });

  it("gives the server's wait, rounded up to what a person can act on", () => {
    expect(retryAfterOf("TOO_MANY_ATTEMPTS:61")).toBe(61);
    expect(retryAfterOf("TOO_MANY_ATTEMPTS")).toBeNull();
    expect(waitLabel(42, en)).toBe("42 s");
    expect(waitLabel(61, en)).toBe("2 min");
    expect(resendWaitMessage(37, en)).toContain("37 s");
    expect(sendLimitMessage(540, en)).toContain("9 min");
    expect(sendLimitMessage(undefined, en)).toBe("Too many requests. Wait a few minutes and try again.");
  });

  it("says it in Arabic too", () => {
    expect(codeErrorMessage("CODE_SUPERSEDED", ar)).toBe("أُرسل رمز أحدث بعد هذا الرمز. استخدم الرمز من أحدث رسالة.");
    expect(codeErrorMessage("TOO_MANY_ATTEMPTS:30", ar)).toBe("محاولات دخول كثيرة. حاول مجددًا بعد 30 ث.");
  });
});
