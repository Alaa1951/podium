import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(), updateUser: vi.fn(), verifyPassword: vi.fn(),
  verifyOtp: vi.fn(), challenge: vi.fn(), log: vi.fn(),
  trusted: vi.fn(), suspicious: vi.fn(), rate: vi.fn(),
}));

vi.mock("next-auth/providers/credentials", () => ({ default: (config: unknown) => config }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUser, update: mocks.updateUser } } }));
vi.mock("@/lib/security", () => ({ normalizeEmail: (email: string) => email.trim().toLowerCase(), verifyPassword: mocks.verifyPassword }));
vi.mock("@/lib/otp", () => ({ verifyOtpChallenge: mocks.verifyOtp }));
vi.mock("@/lib/email", () => ({ sendSecurityAlertEmail: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ limitAuthAttempt: mocks.rate }));
vi.mock("@/lib/trusted-device", () => ({
  getTrustedDevice: mocks.trusted, isSuspiciousLogin: mocks.suspicious,
  logLoginEvent: mocks.log, markTrustedDeviceUsed: vi.fn(), upsertTrustedDevice: vi.fn(),
}));
vi.mock("@/lib/auth-shared", () => ({
  AUTH_ERRORS: { otpRequired: "OTP_REQUIRED", accountDisabled: "ACCOUNT_DISABLED", notActivated: "ACCOUNT_NOT_ACTIVATED", tooManyAttempts: "TOO_MANY_ATTEMPTS" },
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
    mocks.verifyOtp.mockResolvedValue({ ok: false });
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
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ userId: review.id, code: "000000", purpose: "login" });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it("retains password-login rate limits for the exempt account", async () => {
    mocks.rate.mockReturnValue({ ok: false });
    await expect(signIn("credentials", { email: review.email, password: "valid" })).rejects.toThrow("TOO_MANY_ATTEMPTS");
    expect(mocks.findUser).not.toHaveBeenCalled();
  });
});
