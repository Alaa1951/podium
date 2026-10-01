/**
 * Asking for a code: the screen answers the same whatever the address, and
 * the mailbox is told what to do — a code, or (a seat holder with no account
 * and no entry that opens the code door) a pointer to Sign up.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ issue: vi.fn(), sendOtp: vi.fn(), pointer: vi.fn(), rate: vi.fn() }));

vi.mock("@/lib/competitor-access", () => ({ issueCompetitorCode: mocks.issue }));
vi.mock("@/lib/email", () => ({ sendOtpEmail: mocks.sendOtp, sendSignUpPointerEmail: mocks.pointer }));
// No code went to any address a moment ago (otp-flow.integration.test.ts covers the gap).
vi.mock("@/lib/otp", () => ({ createOtpChallenge: vi.fn(), getOtpConfig: () => ({ ttlMinutes: 10 }), codeGapLeft: () => 0, startCodeGap: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/rate-limit", () => ({ limitAuthAttempt: mocks.rate, NETWORK_LIMITS: { codeRequest: 120, codeEntry: 300, passwordSignIn: 120, emailedLink: 60 } }));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/security", () => ({ getBaseUrl: () => "https://podium.test", getIpFromHeaders: (h: Headers) => h.get("x-forwarded-for") }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }) }));

import { requestCompetitorCode } from "@/lib/actions/competitor-login";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rate.mockReturnValue({ ok: true });
  mocks.pointer.mockResolvedValue(undefined);
});

describe("requesting a code", () => {
  it("throttles per caller network as well as per address — never one shared bucket for everybody", async () => {
    mocks.issue.mockResolvedValue({ ok: false });
    await requestCompetitorCode({ email: "sara@example.com" });
    expect(mocks.rate).toHaveBeenCalledWith(expect.objectContaining({ scope: "competitor-code", ip: "203.0.113.7", identifier: "sara@example.com" }));
  });

  it("mails the code when one is issued", async () => {
    mocks.issue.mockResolvedValue({ ok: true, code: "123456", name: "Sara" });
    expect(await requestCompetitorCode({ email: "sara@example.com" })).toEqual({ ok: true });
    expect(mocks.sendOtp).toHaveBeenCalledWith({ email: "sara@example.com", code: "123456", ttlMinutes: 10 });
    expect(mocks.pointer).not.toHaveBeenCalled();
  });

  it("mails a seat holder with no account a pointer to Sign up — and says exactly the same on screen", async () => {
    mocks.issue.mockResolvedValue({ ok: false, signup: true });
    expect(await requestCompetitorCode({ email: "sara@example.com" })).toEqual({ ok: true });
    expect(mocks.pointer).toHaveBeenCalledWith({ email: "sara@example.com", url: "https://podium.test/signup" });
    expect(mocks.sendOtp).not.toHaveBeenCalled();
  });

  it("mails nothing for an address it knows nothing about, and still says the same", async () => {
    mocks.issue.mockResolvedValue({ ok: false });
    expect(await requestCompetitorCode({ email: "nobody@example.com" })).toEqual({ ok: true });
    expect(mocks.sendOtp).not.toHaveBeenCalled();
    expect(mocks.pointer).not.toHaveBeenCalled();
  });
});
