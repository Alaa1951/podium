/**
 * The preview token is the only thing standing between an admin's real
 * identity and a cookie that claims to be somebody else — so every way it can
 * refuse has to refuse.
 */
import { describe, expect, it } from "vitest";

import { signViewAs, verifyViewAs, VIEW_AS_MAX_AGE } from "@/lib/view-as-token";

const SECRET = "test-secret";
const USER = "user_123";
const NOW = 1_000_000_000_000;

describe("the view-as preview token", () => {
  it("reads back the account it was cut for", () => {
    const token = signViewAs(USER, NOW + VIEW_AS_MAX_AGE * 1_000, SECRET);
    expect(verifyViewAs(token, SECRET, NOW)).toBe(USER);
  });

  it("refuses a signature cut with a different secret", () => {
    const token = signViewAs(USER, NOW + VIEW_AS_MAX_AGE * 1_000, "other-secret");
    expect(verifyViewAs(token, SECRET, NOW)).toBeNull();
  });

  it("refuses an expired token", () => {
    const token = signViewAs(USER, NOW - 1, SECRET);
    expect(verifyViewAs(token, SECRET, NOW)).toBeNull();
  });

  it("refuses a token whose payload was edited", () => {
    const token = signViewAs(USER, NOW + VIEW_AS_MAX_AGE * 1_000, SECRET);
    const [,, signature] = token.split(".");
    const forged = `user_999.${NOW + VIEW_AS_MAX_AGE * 1_000}.${signature}`;
    expect(verifyViewAs(forged, SECRET, NOW)).toBeNull();
  });

  it("refuses anything that is not its own shape", () => {
    expect(verifyViewAs(undefined, SECRET, NOW)).toBeNull();
    expect(verifyViewAs("", SECRET, NOW)).toBeNull();
    expect(verifyViewAs("nonsense", SECRET, NOW)).toBeNull();
    expect(verifyViewAs("a.b", SECRET, NOW)).toBeNull();
    expect(verifyViewAs(`${USER}.not-a-number.sig`, SECRET, NOW)).toBeNull();
  });
});
