/**
 * The code door on a shared network, with the REAL throttle (only the mail,
 * the code issuer and the request headers are stand-ins): a gym full of
 * athletes on one Wi-Fi each get their code; one athlete hammering the form
 * is stopped without stopping the others.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ ip: "203.0.113.7" }));
const mocks = vi.hoisted(() => ({ issue: vi.fn(), sendOtp: vi.fn() }));

vi.mock("@/lib/competitor-access", () => ({ issueCompetitorCode: mocks.issue }));
vi.mock("@/lib/email", () => ({ sendOtpEmail: mocks.sendOtp, sendSignUpPointerEmail: vi.fn() }));
// No code went to any address a moment ago (otp-flow.integration.test.ts covers the gap).
vi.mock("@/lib/otp", () => ({ createOtpChallenge: vi.fn(), getOtpConfig: () => ({ ttlMinutes: 10 }), codeGapLeft: () => 0, startCodeGap: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/security", () => ({ getBaseUrl: () => "https://podium.test", getIpFromHeaders: (h: Headers) => h.get("x-forwarded-for") }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": state.ip }) }));

import { requestCompetitorCode } from "@/lib/actions/competitor-login";

const run = Math.random().toString(36).slice(2);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.issue.mockImplementation(async (email: string) => ({ ok: true, code: "123456", name: email }));
});

describe("athletes on one network", () => {
  it("thirty different athletes behind one address each get their code", async () => {
    state.ip = `203.0.113.${Math.floor(Math.random() * 200)}`;
    for (let n = 0; n < 30; n += 1) {
      expect(await requestCompetitorCode({ email: `gym-${run}-${n}@example.com` })).toEqual({ ok: true });
    }
    expect(mocks.sendOtp).toHaveBeenCalledTimes(30);
  });

  it("one athlete asking a sixth time is refused; the athlete next to them still gets a code", async () => {
    state.ip = "198.51.100.23";
    const sara = `sara-${run}@example.com`;
    for (let n = 0; n < 5; n += 1) expect(await requestCompetitorCode({ email: sara })).toEqual({ ok: true });
    expect(await requestCompetitorCode({ email: sara })).toMatchObject({ ok: false, error: "TOO_MANY", retryAfter: expect.any(Number) });
    expect(await requestCompetitorCode({ email: `mona-${run}@example.com` })).toEqual({ ok: true });
    expect(mocks.sendOtp).toHaveBeenCalledTimes(6);
  });
});
