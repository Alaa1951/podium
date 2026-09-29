import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(), updateUser: vi.fn(), verifyPassword: vi.fn(),
  verifyOtp: vi.fn(), challenge: vi.fn(), log: vi.fn(),
  trusted: vi.fn(), suspicious: vi.fn(), rate: vi.fn(), link: vi.fn(),
}));

vi.mock("next-auth/providers/credentials", () => ({ default: (config: unknown) => config }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUser, update: mocks.updateUser } } }));
vi.mock("@/lib/security", () => ({ normalizeEmail: (email: string) => email.trim().toLowerCase(), verifyPassword: mocks.verifyPassword }));
vi.mock("@/lib/otp", () => ({ verifyOtpChallenge: mocks.verifyOtp }));
vi.mock("@/lib/link-seats", () => ({ linkSeatsForUser: mocks.link }));
vi.mock("@/lib/email", () => ({ sendSecurityAlertEmail: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ limitAuthAttempt: mocks.rate }));
vi.mock("@/lib/trusted-device", () => ({
  getTrustedDevice: mocks.trusted, isSuspiciousLogin: mocks.suspicious,
  logLoginEvent: mocks.log, markTrustedDeviceUsed: vi.fn(), upsertTrustedDevice: vi.fn(),
}));
vi.mock("@/lib/auth-shared", () => ({
  AUTH_ERRORS: { otpRequired: "OTP_REQUIRED", accountDisabled: "ACCOUNT_DISABLED", notActivated: "ACCOUNT_NOT_ACTIVATED", tooManyAttempts: "TOO_MANY_ATTEMPTS", codeRefused: "CODE_REFUSED" },
  challengeDevice: mocks.challenge, ipFromReq: () => null,
  parseDevice: () => ({ deviceFingerprint: "hashed-device", trustThisDevice: false }),
  toSessionUser: (user: unknown) => user,
}));

const review = { id: "review-id", email: "review@example.com", name: "Review", role: "admin", status: "active", passwordHash: "hash", forceOtpNextLogin: true };
async function signIn(providerId: string, credentials: Record<string, string>) {
  const { passwordProviders } = await import("@/lib/auth-password");
  const provider = passwordProviders.find((entry) => typeof entry !== "function" && entry.id === providerId) as unknown as {
    authorize: (credentials: Record<string, string>, req: unknown) => Promise<unknown>;
  };
  return provider.authorize(credentials, {});
}

describe("production review account OTP exception", () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_DEV_BYPASS", "true"); // Must still be ignored in production.
    vi.stubEnv("OTP_EXEMPT_EMAILS", review.email);
    mocks.findUser.mockResolvedValue(review);
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.verifyOtp.mockResolvedValue({ ok: false, reason: "invalid" });
    mocks.link.mockResolvedValue({ linked: 0, approved: false, skipped: null });
    mocks.trusted.mockResolvedValue(null);
    mocks.suspicious.mockResolvedValue(true);
    mocks.rate.mockReturnValue({ ok: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("allows the named admin with a valid password without sending OTP", async () => {
    expect(await signIn("credentials", { email: review.email, password: "valid" })).toEqual(review);
    expect(mocks.verifyPassword).toHaveBeenCalledWith("valid", "hash");
    expect(mocks.challenge).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: "LOGIN_SUCCESS", isTrustedDevice: false }));
  });
  it("still rejects a wrong password or missing password", async () => {
    mocks.verifyPassword.mockResolvedValue(false);
    expect(await signIn("credentials", { email: review.email, password: "wrong" })).toBeNull();
    expect(await signIn("credentials", { email: review.email, password: "" })).toBeNull();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it.each(["disabled", "invited"])("keeps %s accounts blocked", async (status) => {
    mocks.findUser.mockResolvedValue({ ...review, status });
    await expect(signIn("credentials", { email: review.email, password: "valid" })).rejects.toThrow("ACCOUNT_");
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });
  it("still sends OTP for an unlisted account and after removal of the exception", async () => {
    vi.stubEnv("OTP_EXEMPT_EMAILS", "someone-else@example.com");
    await expect(signIn("credentials", { email: review.email, password: "valid" })).rejects.toThrow("OTP_REQUIRED");
    expect(mocks.challenge).toHaveBeenCalledOnce();
  });
  it.each(["otp", "competitor"])("does not bypass %s code verification", async (provider) => {
    expect(await signIn(provider, { email: review.email, code: "000000" })).toBeNull();
    expect(mocks.verifyOtp).toHaveBeenCalledWith(expect.objectContaining({ userId: review.id, code: "000000", purpose: "login" }));
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it("retains password-login rate limits for the exempt account", async () => {
    mocks.rate.mockReturnValue({ ok: false });
    await expect(signIn("credentials", { email: review.email, password: "valid" })).rejects.toThrow("TOO_MANY_ATTEMPTS");
    expect(mocks.findUser).not.toHaveBeenCalled();
  });
});

describe("a code that went to an address the account no longer has", () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    mocks.rate.mockReturnValue({ ok: true });
    mocks.findUser.mockResolvedValue({ ...review, role: "competitor", status: "active", signupType: "athlete" });
    mocks.link.mockResolvedValue({ linked: 0, approved: false, skipped: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["address_changed", "no_recipient"])("is refused outright (%s): no session, nothing written", async (reason) => {
    mocks.verifyOtp.mockResolvedValue({ ok: false, reason });
    await expect(signIn("competitor", { email: review.email, code: "123456" })).rejects.toThrow("CODE_REFUSED");
    await expect(signIn("otp", { email: review.email, code: "123456" })).rejects.toThrow("CODE_REFUSED");
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it("stays a plain failure for a wrong code", async () => {
    mocks.verifyOtp.mockResolvedValue({ ok: false, reason: "invalid" });
    expect(await signIn("competitor", { email: review.email, code: "000000" })).toBeNull();
  });

  it("activates in the proof transaction, then links seats in their own once it has committed", async () => {
    const tx = { user: { update: vi.fn().mockResolvedValue(undefined) } };
    const order: string[] = [];
    mocks.verifyOtp.mockImplementation(async (params: { onProven?: (tx: unknown, user: { id: string; role: string }) => Promise<void> }) => {
      await params.onProven?.(tx, { id: review.id, role: "competitor" });
      order.push("proof committed");
      return { ok: true, user: { id: review.id, role: "competitor" }, verifiedEmail: review.email };
    });
    mocks.link.mockImplementation(async () => { order.push("seats linked"); return { linked: 1, approved: false, skipped: null }; });
    expect(await signIn("competitor", { email: review.email, code: "123456" })).toBeTruthy();
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "active" } }));
    // The client, never the proof's transaction: linking is its own unit of work.
    expect(mocks.link).toHaveBeenCalledWith(expect.not.objectContaining({ user: tx.user }), review.id);
    expect(order).toEqual(["proof committed", "seats linked"]);
  });

  it("links nothing when the code is refused", async () => {
    mocks.verifyOtp.mockResolvedValue({ ok: false, reason: "invalid" });
    expect(await signIn("competitor", { email: review.email, code: "000000" })).toBeNull();
    expect(mocks.link).not.toHaveBeenCalled();
  });
});

describe("a password sign-in and seats", () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_EXEMPT_EMAILS", review.email);
    mocks.rate.mockReturnValue({ ok: true });
    mocks.verifyPassword.mockResolvedValue(true);
    // A trusted device and no forced code: the password alone completes
    // the sign-in, which is the case under test (an athlete is not exempt).
    mocks.trusted.mockResolvedValue({ id: "device" });
    mocks.suspicious.mockResolvedValue(false);
    mocks.link.mockResolvedValue({ linked: 0, approved: false, skipped: "unproven" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("asks link-seats for a competitor (which links only a proven address) and never for staff", async () => {
    mocks.findUser.mockResolvedValue({ ...review, role: "competitor", forceOtpNextLogin: false });
    await signIn("credentials", { email: review.email, password: "valid" });
    expect(mocks.link).toHaveBeenCalledWith(expect.anything(), review.id);
    mocks.link.mockClear();
    mocks.findUser.mockResolvedValue(review);
    await signIn("credentials", { email: review.email, password: "valid" });
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it("never lets a linking failure cost the sign-in", async () => {
    mocks.findUser.mockResolvedValue({ ...review, role: "competitor", forceOtpNextLogin: false });
    mocks.link.mockRejectedValue(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await signIn("credentials", { email: review.email, password: "valid" })).toBeTruthy();
    error.mockRestore();
  });
});
