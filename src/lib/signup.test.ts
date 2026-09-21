import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Signing up: what the form must carry, and that an existing address is told
// by email rather than on screen.
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET ||= "test-secret-not-used-anywhere-real";
  return {
    findUser: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    upsertProfile: vi.fn(),
    deleteProfiles: vi.fn(),
    findStudio: vi.fn(),
    findSeries: vi.fn(),
    listSeries: vi.fn(),
    otp: vi.fn(),
    sendOtp: vi.fn(),
    alreadyRegistered: vi.fn(),
    rate: vi.fn(),
  };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUser, create: mocks.createUser, update: mocks.updateUser },
    athleteProfile: { upsert: mocks.upsertProfile, deleteMany: mocks.deleteProfiles },
    studio: { findFirst: mocks.findStudio },
    series: { findFirst: mocks.findSeries, findMany: mocks.listSeries },
  },
}));
vi.mock("@/lib/otp", () => ({ createOtpChallenge: mocks.otp, getOtpConfig: () => ({ ttlMinutes: 10 }) }));
vi.mock("@/lib/email", () => ({ sendOtpEmail: mocks.sendOtp, sendAlreadyRegisteredEmail: mocks.alreadyRegistered }));
vi.mock("@/lib/rate-limit", () => ({ checkRate: mocks.rate, MINUTE_MS: 60_000 }));

/** Somebody signing up alone, looking for a partner: the shortest valid form. */
const athlete = {
  type: "athlete",
  name: "Sara Ali",
  email: "Sara@Example.com",
  phone: "+97455512345",
  dateOfBirth: "1995-04-02",
  sex: "f",
  division: "Open",
  category: "Womens",
  shirtSize: "M",
  password: "Ab3xyz",
  hasPartner: false,
};

/** The same person, arriving with a partner — which asks for a good deal more. */
const pair = {
  ...athlete,
  hasPartner: true,
  teamName: "The Falcons",
  partnerName: "Mona Adel",
  partnerEmail: "mona@example.com",
  partnerSex: "f",
  partnerShirtSize: "L",
};

describe("startSignup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rate.mockReturnValue({ ok: true });
    mocks.findUser.mockResolvedValue(null);
    mocks.createUser.mockResolvedValue({ id: "u1" });
    mocks.otp.mockResolvedValue({ code: "123456" });
    // No competition is open for sign-up unless a test says otherwise, so the
    // field is not demanded.
    mocks.listSeries.mockResolvedValue([]);
    mocks.findSeries.mockResolvedValue(null);
  });

  it("creates a waiting athlete looking for a partner, and emails a code", async () => {
    const { startSignup } = await import("@/lib/actions/signup");
    expect(await startSignup(athlete)).toEqual({ ok: true });
    const data = mocks.createUser.mock.calls[0][0].data;
    expect(data).toMatchObject({
      email: "sara@example.com",
      role: "competitor",
      status: "invited",
      approvalStatus: "pending",
      signupType: "athlete",
      requestedRoleKey: "athlete",
    });
    // Everybody sets a password now, athletes included — the emailed code is
    // still what proves the address the first time.
    expect(data.passwordHash).toEqual(expect.any(String));
    expect(mocks.upsertProfile.mock.calls[0][0].create).toMatchObject({ lookingForPartner: true, partnerEmail: null });
    expect(mocks.sendOtp).toHaveBeenCalledWith(expect.objectContaining({ email: "sara@example.com", code: "123456" }));
  });

  it("requires the athlete details, and a partner when they say they have one", async () => {
    const { startSignup } = await import("@/lib/actions/signup");
    expect(await startSignup({ ...athlete, division: undefined })).toEqual({ ok: false, error: "ATHLETE_DETAILS_REQUIRED" });
    expect(await startSignup({ ...athlete, hasPartner: true })).toEqual({ ok: false, error: "PARTNER_REQUIRED" });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("requires an organiser to pick a role and a strong password", async () => {
    const { startSignup } = await import("@/lib/actions/signup");
    const organiser = { type: "organiser", name: "Omar", email: "omar@example.com", phone: "+97455500000", password: "Ab3xyz" };
    expect(await startSignup(organiser)).toEqual({ ok: false, error: "ROLE_REQUIRED" });
    expect(await startSignup({ ...organiser, roleKey: "judge", password: "short" })).toEqual({ ok: false, error: "PASSWORD_TOO_SHORT" });
    expect(await startSignup({ ...organiser, roleKey: "gym-studio", password: "Str0ngPassword" })).toEqual({ ok: false, error: "GYM_REQUIRED" });
  });

  it("never reveals an existing account — it gets an email instead of a code", async () => {
    mocks.findUser.mockResolvedValue({ id: "old", role: "studio", status: "active", signupType: null, approvalStatus: "approved" });
    const { startSignup } = await import("@/lib/actions/signup");
    expect(await startSignup(athlete)).toEqual({ ok: true });
    expect(mocks.alreadyRegistered).toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.sendOtp).not.toHaveBeenCalled();
  });

  it("throttles repeated sign-ups", async () => {
    mocks.rate.mockReturnValue({ ok: false });
    const { startSignup } = await import("@/lib/actions/signup");
    expect(await startSignup(athlete)).toEqual({ ok: false, error: "TOO_MANY" });
  });

  it("asks an athlete for a password too — a code-only account nobody believes in", async () => {
    const { startSignup } = await import("@/lib/actions/signup");
    const noPassword = { ...athlete, password: undefined };
    expect(await startSignup(noPassword)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await startSignup({ ...athlete, password: "abc" })).toEqual({
      ok: false,
      error: "PASSWORD_TOO_SHORT",
    });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  // ── Which competition ─────────────────────────────────────────────────────

  it("demands a competition only while one is open for sign-up", async () => {
    const { startSignup } = await import("@/lib/actions/signup");

    // Nothing open: the field is not rendered, so it must not be demanded.
    expect(await startSignup(athlete)).toEqual({ ok: true });

    mocks.listSeries.mockResolvedValue([{ id: "s1" }]);
    expect(await startSignup(athlete)).toEqual({ ok: false, error: "COMPETITION_REQUIRED" });
  });

  it("only accepts a competition that is actually open for sign-up", async () => {
    const { startSignup } = await import("@/lib/actions/signup");
    mocks.listSeries.mockResolvedValue([{ id: "s1" }]);

    // A competition that is not open reads as no answer at all.
    mocks.findSeries.mockResolvedValue(null);
    expect(await startSignup({ ...athlete, seriesId: "closed" })).toEqual({
      ok: false,
      error: "COMPETITION_REQUIRED",
    });

    mocks.findSeries.mockResolvedValue({ id: "s1" });
    expect(await startSignup({ ...athlete, seriesId: "s1" })).toEqual({ ok: true });
    expect(mocks.createUser.mock.calls[0][0].data.requestedSeriesId).toBe("s1");
    expect(mocks.findSeries.mock.calls[0][0].where).toMatchObject({
      signupOpen: true,
      status: { in: ["scheduled", "live"] },
    });
  });

  // ── The fields the CRM's own form asks for ────────────────────────────────

  it("asks every athlete for a shirt size — the count is the reason to collect it", async () => {
    const { startSignup } = await import("@/lib/actions/signup");
    const noSize = { ...athlete, shirtSize: undefined };
    expect(await startSignup(noSize)).toEqual({ ok: false, error: "SHIRT_SIZE_REQUIRED" });
    expect(await startSignup({ ...athlete, shirtSize: "XXXL" })).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("asks for a team name only once a partner is named", async () => {
    const { startSignup } = await import("@/lib/actions/signup");
    // Looking for a partner: no team to name yet, and none is demanded.
    expect(await startSignup(athlete)).toEqual({ ok: true });
    const noName = { ...pair, teamName: undefined };
    expect(await startSignup(noName)).toEqual({ ok: false, error: "TEAM_NAME_REQUIRED" });
    expect(await startSignup(pair)).toEqual({ ok: true });
  });

  it("asks for the partner's own gender and shirt size", async () => {
    const { startSignup } = await import("@/lib/actions/signup");
    const half = { ...pair, partnerShirtSize: undefined };
    expect(await startSignup(half)).toEqual({ ok: false, error: "PARTNER_DETAILS_REQUIRED" });
  });

  it("stores the pair's details, and clears them when there is no partner", async () => {
    const { startSignup } = await import("@/lib/actions/signup");

    expect(await startSignup(pair)).toEqual({ ok: true });
    expect(mocks.upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          shirtSize: "M",
          teamName: "The Falcons",
          partnerSex: "f",
          partnerShirtSize: "L",
          lookingForPartner: false,
        }),
      })
    );

    mocks.upsertProfile.mockClear();
    expect(await startSignup(athlete)).toEqual({ ok: true });
    expect(mocks.upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          shirtSize: "M",
          teamName: null,
          partnerSex: null,
          partnerShirtSize: null,
          lookingForPartner: true,
        }),
      })
    );
  });
});
