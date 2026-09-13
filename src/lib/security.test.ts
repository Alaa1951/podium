/**
 * The cryptographic and input-handling helpers behind sign-in.
 *
 * The module reads its secrets at import time and refuses to load without one,
 * so the environment is set here before importing it.
 */
import { beforeAll, describe, expect, it } from "vitest";

process.env.NEXTAUTH_SECRET ||= "test-secret-not-used-anywhere-real";
process.env.DEFAULT_ADMIN_EMAIL ||= "admin@bftmena.com";

type SecurityModule = typeof import("@/lib/security");
let mod: SecurityModule;

beforeAll(async () => {
  mod = await import("@/lib/security");
});

describe("email handling", () => {
  it("normalises case and padding, so one person is one account", () => {
    expect(mod.normalizeEmail("  Omar@Example.COM ")).toBe("omar@example.com");
  });

  it("accepts an ordinary address and rejects obvious rubbish", () => {
    expect(mod.isValidEmail("omar@example.com")).toBe(true);
    expect(mod.isValidEmail("omar@example")).toBe(false);
    expect(mod.isValidEmail("omar example.com")).toBe(false);
    expect(mod.isValidEmail("")).toBe(false);
  });

  it("recognises the configured bootstrap admin, case-insensitively", () => {
    expect(mod.isBootstrapAdminEmail("ADMIN@bftmena.com")).toBe(true);
    expect(mod.isBootstrapAdminEmail("someone@bftmena.com")).toBe(false);
  });
});

describe("password strength", () => {
  it("requires ten characters", () => {
    expect(mod.checkPasswordStrength("Ab3xyzab")).toEqual({
      ok: false,
      reason: "PASSWORD_TOO_SHORT",
    });
  });

  it("requires a digit, a lower-case and an upper-case letter", () => {
    expect(mod.checkPasswordStrength("abcdefghijk")).toMatchObject({ ok: false });
    expect(mod.checkPasswordStrength("ABCDEFGHIJK")).toMatchObject({ ok: false });
    expect(mod.checkPasswordStrength("Abcdefghijk")).toEqual({
      ok: false,
      reason: "PASSWORD_NEEDS_NUMBER",
    });
  });

  it("accepts a password that meets all of it", () => {
    expect(mod.checkPasswordStrength("StudioPass123")).toEqual({ ok: true });
  });

  it("rejects an empty password rather than throwing", () => {
    expect(mod.checkPasswordStrength("")).toMatchObject({ ok: false });
  });
});

describe("password hashing", () => {
  it("never stores the password itself", async () => {
    const hash = await mod.hashPassword("StudioPass123");
    expect(hash).not.toContain("StudioPass123");
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await mod.hashPassword("StudioPass123");
    const b = await mod.hashPassword("StudioPass123");
    expect(a).not.toBe(b);
  });

  it("verifies the right password and refuses the wrong one", async () => {
    const hash = await mod.hashPassword("StudioPass123");
    expect(await mod.verifyPassword("StudioPass123", hash)).toBe(true);
    expect(await mod.verifyPassword("studiopass123", hash)).toBe(false);
    expect(await mod.verifyPassword("", hash)).toBe(false);
  });
});

describe("one-time secrets", () => {
  it("issues a six-digit code, zero-padded", () => {
    for (let i = 0; i < 200; i++) {
      const code = mod.generateOtp();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("hashes a code to something stable and unlike the code", () => {
    const hash = mod.hashSecret("123456");
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("123456");
    expect(mod.hashSecret("123456")).toBe(hash);
    expect(mod.hashSecret("123457")).not.toBe(hash);
  });

  it("issues an unguessable link token", () => {
    const a = mod.generateToken();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(mod.generateToken()).not.toBe(a);
  });

  it("hashes a device fingerprint, and keeps an empty one empty", () => {
    expect(mod.hashDeviceFingerprint("")).toBe("");
    const hash = mod.hashDeviceFingerprint("device|ua|tz");
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("device");
  });
});

describe("constant-time comparison", () => {
  it("matches equal strings and rejects different ones", () => {
    expect(mod.safeEqual("abc", "abc")).toBe(true);
    expect(mod.safeEqual("abc", "abd")).toBe(false);
  });

  it("returns false rather than throwing on a length mismatch", () => {
    expect(mod.safeEqual("abc", "abcd")).toBe(false);
    expect(mod.safeEqual("", "a")).toBe(false);
  });
});

describe("client address", () => {
  it("takes the first hop of x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(mod.getIpFromHeaders(headers)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip, then to null", () => {
    expect(mod.getIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(mod.getIpFromHeaders(new Headers())).toBeNull();
  });
});

describe("link origin", () => {
  it("prefers configuration over the Host header", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://podium.bftmena.com";
    const forged = new Request("http://localhost/x", { headers: { host: "evil.example" } });
    // A reset link must never be built from a header an attacker controls.
    expect(mod.getBaseUrl(forged)).toBe("https://podium.bftmena.com");
  });

  it("trims a trailing slash", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://podium.bftmena.com/";
    expect(mod.getBaseUrl()).toBe("https://podium.bftmena.com");
  });
});
