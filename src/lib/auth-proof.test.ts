/**
 * Spending a code or a link: it proves the address it was SENT TO, and only
 * while that is still the account's address. Everything below is the rule
 * that a right code to the wrong address does nothing at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET ||= "test-secret-not-used-anywhere-real";
});

import { consumeLoginCode, forgetAddressProof, peekAuthToken, spendAuthToken } from "@/lib/auth-proof";
import { hashSecret } from "@/lib/security";

const user = {
  id: "u1", email: "sara@example.com", name: "Sara", role: "competitor", status: "active", approvalStatus: "approved",
  studioId: null, locale: "en", signupType: "athlete", emailVerified: null, passwordHash: null, forceOtpNextLogin: false, archivedAt: null,
};

/**
 * A fake client whose $transaction just runs the work against itself. The
 * locking read ($queryRaw) answers with `locked` — the committed row — which
 * may differ from what the plain read (user.findUnique) says.
 */
function fakeDb(overrides: Partial<{ user: typeof user; locked: Partial<typeof user>; challenge: unknown; earlier: unknown[]; token: unknown; spent: number }> = {}) {
  const row = overrides.user ?? user;
  const locked = { email: row.email, status: row.status, archivedAt: row.archivedAt, ...overrides.locked };
  const spent = overrides.spent ?? 1;
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([locked]),
    user: { findUnique: vi.fn().mockResolvedValue(row), update: vi.fn().mockResolvedValue(undefined) },
    otpChallenge: {
      findFirst: vi.fn().mockResolvedValue(overrides.challenge ?? null),
      findMany: vi.fn().mockResolvedValue(overrides.earlier ?? []),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: spent }),
    },
    authToken: {
      findFirst: vi.fn().mockResolvedValue(overrides.token ?? null),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: spent }),
    },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
  return db;
}

const future = new Date(Date.now() + 60_000);
const goodCode = { id: "c1", codeHash: hashSecret("123456"), attempts: 0, expiresAt: future, sentTo: "sara@example.com", createdAt: new Date() };
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe("consuming a sign-in code", () => {
  let onProven: ReturnType<typeof vi.fn<(tx: unknown, user: unknown) => Promise<void>>>;
  beforeEach(() => {
    onProven = vi.fn<(tx: unknown, user: unknown) => Promise<void>>().mockResolvedValue(undefined);
  });

  it("locks the account row, spends the code, records the proven address and runs onProven in the same transaction", async () => {
    const db = fakeDb({ challenge: goodCode });
    const result = await consumeLoginCode({ db: db as never, userId: "u1", code: "123456", purpose: "login", maxAttempts: 5, onProven: onProven as never });
    expect(result).toMatchObject({ ok: true, verifiedEmail: "sara@example.com" });
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.otpChallenge.updateMany).toHaveBeenCalledWith({ where: { id: "c1", consumedAt: null, expiresAt: { gt: expect.any(Date) } }, data: { consumedAt: expect.any(Date) } });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "ReadCommitted" }));
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ verifiedEmail: "sara@example.com" }) }));
    expect(onProven).toHaveBeenCalledWith(db, expect.objectContaining({ id: "u1" }));
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("refuses a right code sent to an address the account no longer has — spent, nothing recorded, onProven never runs", async () => {
    const db = fakeDb({ challenge: goodCode, user: { ...user, email: "new@example.com" } });
    const result = await consumeLoginCode({ db: db as never, userId: "u1", code: "123456", purpose: "login", maxAttempts: 5, onProven: onProven as never });
    expect(result).toEqual({ ok: false, reason: "address_changed" });
    expect(db.otpChallenge.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { consumedAt: expect.any(Date) } }));
    expect(db.user.update).not.toHaveBeenCalled();
    expect(onProven).not.toHaveBeenCalled();
  });

  it("refuses a code with no recipient on record (issued before the rule)", async () => {
    const db = fakeDb({ challenge: { ...goodCode, sentTo: null } });
    expect(await consumeLoginCode({ db: db as never, userId: "u1", code: "123456", purpose: "login", maxAttempts: 5 })).toEqual({ ok: false, reason: "no_recipient" });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("compares addresses normalised, so case in the mailbox does not refuse a good code", async () => {
    const db = fakeDb({ challenge: { ...goodCode, sentTo: "Sara@Example.com" } });
    expect(await consumeLoginCode({ db: db as never, userId: "u1", code: "123456", purpose: "login", maxAttempts: 5 })).toMatchObject({ ok: true });
  });

  it("counts a wrong code against the attempts and spends nothing", async () => {
    const db = fakeDb({ challenge: goodCode });
    expect(await consumeLoginCode({ db: db as never, userId: "u1", code: "000000", purpose: "login", maxAttempts: 5 })).toEqual({ ok: false, reason: "invalid" });
    expect(db.otpChallenge.updateMany).toHaveBeenCalledWith({ where: { id: "c1", consumedAt: null }, data: { attempts: { increment: 1 } } });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("reports no code, too many attempts, and an unusable account", async () => {
    // No code outstanding and no code of ours typed: the same answer as a
    // wrong code, so it cannot tell a stranger whether a code is pending.
    expect(await consumeLoginCode({ db: fakeDb() as never, userId: "u1", code: "123456", purpose: "login", maxAttempts: 5 })).toEqual({ ok: false, reason: "invalid" });
    expect(await consumeLoginCode({ db: fakeDb({ challenge: { ...goodCode, attempts: 5 } }) as never, userId: "u1", code: "123456", purpose: "login", maxAttempts: 5 })).toEqual({ ok: false, reason: "attempts" });
    expect(await consumeLoginCode({ db: fakeDb({ challenge: goodCode, user: { ...user, status: "disabled" } }) as never, userId: "u1", code: "123456", purpose: "login", maxAttempts: 5 })).toEqual({ ok: false, reason: "account" });
  });

  it("the right code of an earlier email, since replaced, is 'superseded' — and costs the current code no attempt", async () => {
    const db = fakeDb({ challenge: goodCode, earlier: [{ codeHash: hashSecret("111111"), createdAt: minutesAgo(1) }] });
    expect(await consumeLoginCode({ db: db as never, userId: "u1", code: "111111", purpose: "login", maxAttempts: 5 })).toEqual({ ok: false, reason: "superseded" });
    expect(db.otpChallenge.updateMany).not.toHaveBeenCalled();
    expect(db.otpChallenge.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ NOT: { id: "c1" } }) }));
  });

  it("the right code of an expired or used challenge, with nothing newer to use, is 'expired'", async () => {
    const db = fakeDb({ earlier: [{ codeHash: hashSecret("123456"), createdAt: minutesAgo(11) }] });
    expect(await consumeLoginCode({ db: db as never, userId: "u1", code: "123456", purpose: "login", maxAttempts: 5 })).toEqual({ ok: false, reason: "expired" });
  });

  it("a wrong code against a locked code is still only 'invalid' — only the right code learns it is locked", async () => {
    const db = fakeDb({ challenge: { ...goodCode, attempts: 5 } });
    expect(await consumeLoginCode({ db: db as never, userId: "u1", code: "000000", purpose: "login", maxAttempts: 5 })).toEqual({ ok: false, reason: "invalid" });
  });

  it("decides on the LOCKED row: a plain read still showing the old address does not let the code through", async () => {
    const db = fakeDb({ challenge: goodCode, locked: { email: "new@example.com" } });
    expect(await consumeLoginCode({ db: db as never, userId: "u1", code: "123456", purpose: "login", maxAttempts: 5, onProven: onProven as never })).toEqual({ ok: false, reason: "address_changed" });
    expect(onProven).not.toHaveBeenCalled();
  });

  it("refuses when another submission spent the code first (the conditional spend matched nothing)", async () => {
    const db = fakeDb({ challenge: goodCode, spent: 0 });
    expect(await consumeLoginCode({ db: db as never, userId: "u1", code: "123456", purpose: "login", maxAttempts: 5, onProven: onProven as never })).toEqual({ ok: false, reason: "expired" });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(onProven).not.toHaveBeenCalled();
  });

  it("keeps nothing if onProven throws — the transaction fails as a whole", async () => {
    const db = fakeDb({ challenge: goodCode });
    onProven.mockRejectedValue(new Error("link failed"));
    await expect(consumeLoginCode({ db: db as never, userId: "u1", code: "123456", purpose: "login", maxAttempts: 5, onProven: onProven as never })).rejects.toThrow("link failed");
  });
});

const goodLink = { id: "t1", userId: "u1", tokenHash: hashSecret("tok"), expiresAt: future, sentTo: "sara@example.com" };

describe("spending an emailed link", () => {
  it("proves the address and applies the change in one transaction", async () => {
    const db = fakeDb({ token: goodLink });
    const apply = vi.fn().mockResolvedValue(undefined);
    expect(await spendAuthToken({ db: db as never, token: "tok", purpose: "reset", onProven: apply })).toMatchObject({ ok: true, verifiedEmail: "sara@example.com" });
    expect(db.authToken.updateMany).toHaveBeenCalledWith({ where: { id: "t1", usedAt: null, expiresAt: { gt: expect.any(Date) } }, data: { usedAt: expect.any(Date) } });
    expect(apply).toHaveBeenCalled();
  });

  it("refuses when the link was spent by a concurrent request — the conditional spend matched nothing", async () => {
    const db = fakeDb({ token: goodLink, spent: 0 });
    const apply = vi.fn();
    expect(await spendAuthToken({ db: db as never, token: "tok", purpose: "reset", onProven: apply })).toEqual({ ok: false, reason: "expired" });
    expect(apply).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("decides on the LOCKED row: an email change committed after the link was looked up refuses it", async () => {
    const db = fakeDb({ token: goodLink, locked: { email: "new@example.com" } });
    const apply = vi.fn();
    expect(await spendAuthToken({ db: db as never, token: "tok", purpose: "reset", onProven: apply })).toEqual({ ok: false, reason: "address_changed" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("refuses a link sent to a former address — invitation included — and applies nothing", async () => {
    const db = fakeDb({ token: goodLink, user: { ...user, email: "new@example.com" } });
    const apply = vi.fn();
    expect(await spendAuthToken({ db: db as never, token: "tok", purpose: "invite", onProven: apply })).toEqual({ ok: false, reason: "address_changed" });
    expect(apply).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.authToken.updateMany).toHaveBeenCalled(); // spent
  });

  it("refuses a link with no recipient on record, invitation included", async () => {
    const db = fakeDb({ token: { ...goodLink, sentTo: null } });
    const apply = vi.fn();
    expect(await spendAuthToken({ db: db as never, token: "tok", purpose: "invite", onProven: apply })).toEqual({ ok: false, reason: "no_recipient" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("peeks without spending, and hides a link that would be refused", async () => {
    const withUser = { ...goodLink, user };
    expect(await peekAuthToken(fakeDb({ token: withUser }) as never, { token: "tok", purpose: "reset" })).toMatchObject({ id: "t1" });
    expect(await peekAuthToken(fakeDb({ token: { ...withUser, sentTo: null } }) as never, { token: "tok", purpose: "reset" })).toBeNull();
    expect(await peekAuthToken(fakeDb({ token: { ...withUser, user: { ...user, email: "new@example.com" } } }) as never, { token: "tok", purpose: "reset" })).toBeNull();
  });
});

describe("when the account's email changes", () => {
  it("drops the proof and spends every open code and link", async () => {
    const db = fakeDb();
    await forgetAddressProof(db as never, "u1");
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { verifiedEmail: null } });
    expect(db.otpChallenge.updateMany).toHaveBeenCalledWith({ where: { userId: "u1", consumedAt: null }, data: { consumedAt: expect.any(Date) } });
    expect(db.authToken.updateMany).toHaveBeenCalledWith({ where: { userId: "u1", usedAt: null }, data: { usedAt: expect.any(Date) } });
  });
});
