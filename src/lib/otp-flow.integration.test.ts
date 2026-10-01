/**
 * A NEW JUDGE'S SIGN-IN CODES, AGAINST A REAL DATABASE — the sign-up actions,
 * the code doors (auth-password.ts) and the resend route themselves, with
 * email captured instead of sent. What made valid-looking codes fail:
 *
 *   · each new code replaces the last, and typing the replaced code (from a
 *     slower email) burned the NEW code's five attempts — then the right,
 *     newest code was refused too, with the same "not valid" sentence;
 *   · the sign-up screen's "send again" had no cooldown: three taps, three
 *     codes racing each other, then "wait a few minutes" with no time;
 *   · the verification rate limit was shown as "not valid or has expired".
 *
 *   INTEGRATION_DB=1 npx vitest run src/lib/otp-flow.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const on = process.env.INTEGRATION_DB === "1";
  if (on) {
    try { process.loadEnvFile(".env"); } catch { /* DATABASE_URL must already be set */ }
  }
  process.env.NEXTAUTH_SECRET ||= "integration-test-secret";
  // The real rules, whatever the local .env says.
  delete process.env.OTP_DEV_BYPASS;
  delete process.env.OTP_TTL_MINUTES;
  delete process.env.OTP_MAX_ATTEMPTS;
  delete process.env.OTP_RESEND_COOLDOWN_SECONDS;
  process.env.TEST_ACCOUNT_EMAILS = "";
  process.env.OTP_EXEMPT_EMAILS = "";
  const base = process.env.DATABASE_URL ?? "mysql://skipped@127.0.0.1:1/skipped";
  const url = new URL(base);
  url.pathname = `/pudem_otp_${Math.random().toString(36).slice(2, 12)}`;
  process.env.DATABASE_URL = url.toString();
  return { on, base, schemaUrl: url.toString(), ip: "203.0.113.7", mail: [] as { email: string; code: string }[] };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": env.ip }) }));
vi.mock("@/lib/email", () => ({
  sendOtpEmail: async (params: { email: string; code: string }) => { env.mail.push({ email: params.email, code: params.code }); },
  sendAlreadyRegisteredEmail: async () => undefined,
  sendSecurityAlertEmail: async () => undefined,
  sendSignUpPointerEmail: async () => undefined,
}));

import { prisma } from "@/lib/prisma";
import { passwordProviders } from "@/lib/auth-password";
import { resendSignupCode, startSignup } from "@/lib/actions/signup";
import { POST as resendRoute } from "@/app/api/auth/resend-code/route";
import { createSchema } from "@/lib/schedule-integration-fixture";

type Authorize = (credentials: Record<string, string>, req: unknown) => Promise<unknown>;
const provider = (id: string) => (passwordProviders.find((one) => (one as { options?: { id?: string } }).options?.id === id) as unknown as { options: { authorize: Authorize } }).options.authorize;
const req = { headers: { "x-forwarded-for": env.ip } };
/** What the form gets back: the signed-in user, or the error the server threw. */
const answer = (id: string, credentials: Record<string, string>) =>
  provider(id)(credentials, req).then((user) => ({ user: user ?? null }), (error: Error) => ({ error: error.message }));
const codeDoor = (email: string, code: string) => answer("competitor", { email, code });
const PASSWORD = "Judge-Pass-2026";
const judge = (email: string) => startSignup({ type: "organiser", roleKey: "judge", name: "New Judge", email, phone: "+97455512345", password: PASSWORD });
const lastCode = () => env.mail[env.mail.length - 1].code;
const wrong = (right: string) => (right === "000000" ? "111111" : "000000");
const resend = (email: string) => resendRoute(new Request("http://localhost/api/auth/resend-code", {
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": env.ip }, body: JSON.stringify({ email }),
})).then((response) => response.json());

// The in-memory limits (rate-limit.ts), moved through time without waiting.
type Memory = { __pdRateBuckets?: Map<string, { windowStart: number }>; __pdCooldowns?: Map<string, number> };
const memory = globalThis as unknown as Memory;
/** Time passes: the in-memory limits, and the codes' own clocks (issued, expiring). */
const pass = async (ms: number) => {
  for (const bucket of memory.__pdRateBuckets?.values() ?? []) bucket.windowStart -= ms;
  for (const [key, until] of memory.__pdCooldowns ?? []) memory.__pdCooldowns!.set(key, until - ms);
  const seconds = Math.round(ms / 1000);
  await prisma.$executeRaw`UPDATE OtpChallenge SET createdAt = createdAt - INTERVAL ${seconds} SECOND, expiresAt = expiresAt - INTERVAL ${seconds} SECOND`;
};

describe.skipIf(!env.on)("a new Judge's sign-in codes", { timeout: 90_000 }, () => {
  let drop: (() => Promise<void>) | undefined;
  beforeAll(async () => { drop = await createSchema(env.base, env.schemaUrl); }, 180_000);
  afterAll(async () => { await prisma.$disconnect(); await drop?.(); });
  beforeEach(async () => {
    env.mail.length = 0;
    memory.__pdRateBuckets?.clear();
    memory.__pdCooldowns?.clear();
    await prisma.otpChallenge.deleteMany();
    await prisma.loginEvent.deleteMany();
    await prisma.trustedDevice.deleteMany();
    await prisma.user.deleteMany();
  });

  it("a Judge who signs up and types the code is signed in, active, waiting for approval as a Judge", async () => {
    expect(await judge("judge.a@example.com")).toEqual({ ok: true, resendIn: 60 });
    expect(await codeDoor("Judge.A@Example.com ", lastCode())).toMatchObject({ user: { role: "organiser", status: "active" } });
    expect(await prisma.user.findUniqueOrThrow({ where: { email: "judge.a@example.com" } }))
      .toMatchObject({ status: "active", approvalStatus: "pending", requestedRoleKey: "judge", verifiedEmail: "judge.a@example.com" });
  });

  it("the code of an earlier email is named as replaced, costs the newest code nothing, and the newest code works", async () => {
    await judge("judge.b@example.com");
    const first = lastCode();
    await pass(61_000);
    expect(await resendSignupCode({ email: "judge.b@example.com" })).toEqual({ ok: true, resendIn: 60 });
    const second = lastCode();
    for (let i = 0; i < 5; i++) expect(await codeDoor("judge.b@example.com", first)).toEqual({ error: "CODE_SUPERSEDED" });
    // Before the fix: attempts 5, and the newest code refused.
    expect((await prisma.otpChallenge.findFirstOrThrow({ where: { consumedAt: null } })).attempts).toBe(0);
    // Not guesses: nothing counts toward marking the account suspicious.
    expect(await prisma.loginEvent.count({ where: { eventType: "OTP_FAILED" } })).toBe(0);
    expect(await codeDoor("judge.b@example.com", second)).toMatchObject({ user: { status: "active" } });
  });

  it("'send again' waits out the cooldown — no second code races the first — and says how long", async () => {
    await judge("judge.c@example.com");
    const refused = await resendSignupCode({ email: "judge.c@example.com" });
    expect(refused).toMatchObject({ ok: false, error: "RESEND_COOLDOWN" });
    expect((refused as { retryAfter: number }).retryAfter).toBeGreaterThan(55);
    expect(env.mail).toHaveLength(1);
    // The code already sent still works.
    await pass(30_000);
    expect(await codeDoor("judge.c@example.com", lastCode())).toMatchObject({ user: { status: "active" } });
  });

  it("the send limit: three resends in 15 minutes, then the exact wait — the same for an address with no account", async () => {
    for (const email of ["judge.d@example.com", "nobody@example.com"]) {
      if (email.startsWith("judge")) await judge(email);
      const answers = [];
      for (let i = 0; i < 4; i++) {
        await pass(61_000);
        answers.push(await resendSignupCode({ email }));
      }
      expect(answers.slice(0, 3)).toEqual([{ ok: true, resendIn: 60 }, { ok: true, resendIn: 60 }, { ok: true, resendIn: 60 }]);
      expect(answers[3]).toMatchObject({ ok: false, error: "TOO_MANY" });
      // A fixed window from the first resend: 15 minutes, less the 4 × 61 s that passed.
      expect((answers[3] as { retryAfter: number }).retryAfter).toBe(900 - 3 * 61);
      memory.__pdRateBuckets?.clear();
    }
  });

  it("an expired code, typed right, is named as expired", async () => {
    await judge("judge.e@example.com");
    await prisma.otpChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await codeDoor("judge.e@example.com", lastCode())).toEqual({ error: "CODE_EXPIRED" });
  });

  it("five wrong codes lock that code: the right one is named as locked; a new code works again", async () => {
    await judge("judge.f@example.com");
    const right = lastCode();
    for (let i = 0; i < 5; i++) expect(await codeDoor("judge.f@example.com", wrong(right))).toEqual({ user: null });
    expect(await prisma.loginEvent.count({ where: { eventType: "OTP_FAILED" } })).toBe(5);
    expect(await codeDoor("judge.f@example.com", right)).toEqual({ error: "CODE_LOCKED" });
    // A locked code holds nothing back: a new one may be asked for at once.
    expect(await resendSignupCode({ email: "judge.f@example.com" })).toMatchObject({ ok: true });
    expect(await codeDoor("judge.f@example.com", lastCode())).toMatchObject({ user: { status: "active" } });
  });

  it("the verification limit says how long it lasts; waiting there does not extend it; afterwards the code works", async () => {
    await judge("judge.g@example.com");
    const right = lastCode();
    for (let i = 0; i < 10; i++) await codeDoor("judge.g@example.com", wrong(right));
    // Before the fix: "TOO_MANY_ATTEMPTS", shown as "not valid or has expired".
    const limited = await codeDoor("judge.g@example.com", right) as { error: string };
    expect(limited.error).toMatch(/^TOO_MANY_ATTEMPTS:(89[0-9]|900)$/);
    await pass(120_000);
    const later = await codeDoor("judge.g@example.com", right) as { error: string };
    expect(Number(later.error.split(":")[1])).toBeLessThanOrEqual(Number(limited.error.split(":")[1]) - 119);
    // The window ends; a fresh code (the old one burned its attempts) signs in.
    await pass(15 * 60_000);
    expect(await resendSignupCode({ email: "judge.g@example.com" })).toMatchObject({ ok: true });
    expect(await codeDoor("judge.g@example.com", lastCode())).toMatchObject({ user: { status: "active" } });
  });

  it("once a code has signed somebody in, a new one may be asked for at once", async () => {
    await judge("judge.k@example.com");
    expect(await codeDoor("judge.k@example.com", lastCode())).toMatchObject({ user: { status: "active" } });
    expect(await resend("judge.k@example.com")).toEqual({ ok: true, cooldownSeconds: 60 });
    expect(env.mail).toHaveLength(2);
  });

  it("a wrong code and an unknown address get the same answer", async () => {
    await judge("judge.h@example.com");
    expect(await codeDoor("judge.h@example.com", wrong(lastCode()))).toEqual({ user: null });
    expect(await codeDoor("nobody.h@example.com", "123456")).toEqual({ user: null });
  });

  it("an approved Judge signing in twice with the password: one code, and it works on /verify", async () => {
    await judge("judge.i@example.com");
    await codeDoor("judge.i@example.com", lastCode());
    const device = { email: "judge.i@example.com", password: PASSWORD, deviceFingerprint: "phone-1" };
    await pass(61_000);
    expect(await answer("credentials", device)).toEqual({ error: "OTP_REQUIRED" });
    expect(env.mail).toHaveLength(2);
    const code = lastCode();
    // Signing in again while that email is on its way sends nothing new.
    expect(await answer("credentials", device)).toEqual({ error: "OTP_REQUIRED" });
    expect(env.mail).toHaveLength(2);
    expect(await answer("otp", { email: "judge.i@example.com", code, deviceFingerprint: "phone-1", trustThisDevice: "false" }))
      .toMatchObject({ user: { email: "judge.i@example.com", role: "organiser" } });
  });

  it("/verify's resend: waits, then sends, then is limited — known or unknown address alike", async () => {
    await judge("judge.j@example.com");
    await codeDoor("judge.j@example.com", lastCode());
    for (const email of ["judge.j@example.com", "nobody.j@example.com"]) {
      await pass(61_000);
      expect(await resend(email)).toEqual({ ok: true, cooldownSeconds: 60 });
      expect(await resend(email)).toMatchObject({ ok: true, waiting: true });
      for (let i = 0; i < 4; i++) { await pass(61_000); await resend(email); }
      await pass(61_000);
      expect(await resend(email)).toMatchObject({ ok: true, limited: true });
    }
    // Only the real account got codes: one per allowed resend.
    expect(env.mail.filter((one) => one.email === "judge.j@example.com")).toHaveLength(1 + 5);
    expect(env.mail.some((one) => one.email === "nobody.j@example.com")).toBe(false);
  });
});
