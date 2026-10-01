import type { OtpPurpose, TokenPurpose } from "@/generated/prisma/enums";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { hashSecret, normalizeEmail, safeEqual } from "@/lib/security";

// ─────────────────────────────────────────────────────────────────────────────
// PROOF OF AN ADDRESS — the one place a code or a link is spent.
//
// A code proves the mailbox it was SENT TO, not whatever address the account
// carries when it is typed in. So every code and link records its recipient
// (`sentTo`), and is accepted only while the account's email is still that
// recipient, checked with the user row LOCKED so a change of address cannot
// slip in between the check and the write. A code or link with no recipient
// (issued before the column existed) is never accepted: the person asks for
// a new one. Refusal means nothing happens — no session, no password, no
// activation, no proof, no seat — and the code or link is spent.
//
// On acceptance the proven address is written to `User.verifiedEmail` and
// `onProven` runs in the SAME transaction (activation, a new password), so
// the proof and what it authorises commit together or not at all. Seats are
// linked AFTER it commits, in their own transaction (link-seats.ts).
//
// WHAT DECIDES, UNDER CONCURRENCY. A plain read inside a transaction can
// answer from the snapshot an earlier read opened, so it may miss an email
// change or a spend that committed a moment ago. Nothing here decides on a
// plain read: the account's address and status come from a LOCKING read
// (`SELECT … FOR UPDATE` returns the last committed row), and a code or link
// is spent by a CONDITIONAL update (`… WHERE consumedAt/usedAt IS NULL AND
// expiresAt > now`) whose row count says whether this caller won. The
// transactions also run at READ COMMITTED, so the other reads are fresh too.
//
// No "server-only" import on purpose: the integration harness runs this
// against an ephemeral database from a plain Node script.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The client a proof runs against. Always the client, never a transaction:
 * a proof is its own transaction (Prisma 7 would nest one inside another as
 * a savepoint of its own tracking, which this code keeps out of).
 */
export type ProofDb = PrismaClient;

export type ProofRefusal =
  /**
   * A code: the RIGHT code of one that has expired or was already used (a
   * link: no unused, unexpired link).
   */
  | "expired"
  /** The right code of an earlier email, replaced since by a newer code. */
  | "superseded"
  /** The right code, but too many wrong ones were typed against it first. */
  | "attempts"
  /** Wrong code — or no code outstanding at all: the two answer alike. */
  | "invalid"
  /** The code/link was issued before recipients were recorded. */
  | "no_recipient"
  /** The account's email is no longer the address this was sent to. */
  | "address_changed"
  /** The account cannot be used (disabled, archived, missing). */
  | "account";

export type ProvenUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  approvalStatus: string;
  studioId: string | null;
  locale: string;
  signupType: string | null;
  emailVerified: Date | null;
  passwordHash: string | null;
  forceOtpNextLogin: boolean;
};

export type ProofResult =
  | { ok: true; user: ProvenUser; verifiedEmail: string }
  | { ok: false; reason: ProofRefusal };

const USER_SELECT = {
  id: true, email: true, name: true, role: true, status: true, approvalStatus: true, studioId: true,
  locale: true, signupType: true, emailVerified: true, passwordHash: true, forceOtpNextLogin: true,
  archivedAt: true,
} as const;

type LockedAccount = { email: string; status: string; archivedAt: Date | null };

/**
 * Lock the account row for the rest of the transaction and read it. The
 * address and status are taken from the locking read itself — the committed
 * row — never from a plain read that could be answered from an older snapshot.
 */
async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<LockedAccount[]>`SELECT email, status, archivedAt FROM User WHERE id = ${userId} FOR UPDATE`;
  const locked = rows[0];
  if (!locked) return null;
  const user = await tx.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!user) return null;
  return { ...user, email: locked.email, status: locked.status, archivedAt: locked.archivedAt };
}

/** The isolation every proof runs at (see the header). */
export const PROOF_TX = { timeout: 30_000, isolationLevel: "ReadCommitted" } as const;

function inTransaction<T>(db: ProofDb, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(work, PROOF_TX);
}

/** What a proven address does to the account, whatever door it came through. */
async function recordProof(tx: Prisma.TransactionClient, user: { id: string; emailVerified: Date | null }, sentTo: string) {
  await tx.user.update({
    where: { id: user.id },
    data: { verifiedEmail: sentTo, emailVerified: user.emailVerified ?? new Date() },
  });
}

/** How far back an earlier code is still recognised, to say WHY it no longer works. */
const EARLIER_CODES_MS = 24 * 60 * 60_000;
const EARLIER_CODES_LOOKED_AT = 10;

/**
 * Spend a sign-in code. `onProven` runs inside the transaction after the
 * proof is recorded; if it throws, nothing is kept — not even the proof.
 *
 * WHY A CODE IS REFUSED. Each new code replaces the one before it, and email
 * can arrive late and out of order — so a person often types the code of an
 * earlier email. That is said as such ("superseded"), and it does NOT count
 * against the current code's attempts: typing a real code we sent is not a
 * guess. Likewise the right code of an expired or used challenge is
 * "expired", and the right code of a challenge locked by wrong guesses is
 * "attempts". Each of those answers needs a real code from that mailbox, so
 * none tells a stranger anything; everything else — a wrong code, or no code
 * outstanding at all — is "invalid", the same answer an unknown address gets
 * from the sign-in doors.
 */
export async function consumeLoginCode(params: {
  db: ProofDb;
  userId: string;
  code: string;
  purpose: OtpPurpose;
  maxAttempts: number;
  onProven?: (tx: Prisma.TransactionClient, user: ProvenUser) => Promise<void>;
}): Promise<ProofResult> {
  return inTransaction(params.db, async (tx) => {
    const user = await lockUser(tx, params.userId);
    if (!user || user.archivedAt || user.status === "disabled") return { ok: false, reason: "account" };

    const typed = hashSecret(params.code);
    const challenge = await tx.otpChallenge.findFirst({
      where: { userId: user.id, purpose: params.purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });

    if (!challenge || !safeEqual(challenge.codeHash, typed)) {
      // Not the current code. One we sent this account earlier?
      const earlier = await tx.otpChallenge.findMany({
        where: {
          userId: user.id, purpose: params.purpose, createdAt: { gt: new Date(Date.now() - EARLIER_CODES_MS) },
          ...(challenge ? { NOT: { id: challenge.id } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: EARLIER_CODES_LOOKED_AT,
        select: { codeHash: true, createdAt: true },
      });
      const match = earlier.find((one) => safeEqual(one.codeHash, typed));
      if (match) return { ok: false, reason: challenge && challenge.createdAt >= match.createdAt ? "superseded" : "expired" };
      if (challenge) {
        await tx.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { attempts: { increment: 1 } } });
      }
      return { ok: false, reason: "invalid" };
    }
    if (challenge.attempts >= params.maxAttempts) return { ok: false, reason: "attempts" };

    // Right code — but is it still the right mailbox? Either way this code is
    // finished with. Spent conditionally: of two submissions, one wins.
    const now = new Date();
    const spent = await tx.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (spent.count !== 1) return { ok: false, reason: "expired" };
    const recipient = challenge.sentTo ? normalizeEmail(challenge.sentTo) : null;
    if (!recipient) return { ok: false, reason: "no_recipient" };
    if (recipient !== normalizeEmail(user.email)) return { ok: false, reason: "address_changed" };

    await recordProof(tx, user, recipient);
    const proven: ProvenUser = { ...user };
    if (params.onProven) await params.onProven(tx, proven);
    return { ok: true, user: proven, verifiedEmail: recipient };
  });
}

/**
 * Whether a link can still be used — for the page that shows the form. Reads
 * only; the link is spent by `spendAuthToken` when the form is submitted.
 */
export async function peekAuthToken(db: ProofDb, params: { token: string; purpose: TokenPurpose }) {
  const record = await db.authToken.findFirst({
    where: { tokenHash: hashSecret(params.token), purpose: params.purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
    include: { user: { select: USER_SELECT } },
  });
  if (!record || record.expiresAt <= new Date()) return null;
  if (!record.sentTo || normalizeEmail(record.sentTo) !== normalizeEmail(record.user.email)) return null;
  if (record.user.archivedAt || record.user.status === "disabled") return null;
  return record;
}

/**
 * Spend an emailed link (invitation or reset). Same rule as a code: the
 * account's email must still be the address the link went to, checked under
 * the row lock; `onProven` runs in the same transaction.
 */
export async function spendAuthToken(params: {
  db: ProofDb;
  token: string;
  purpose: TokenPurpose;
  onProven: (tx: Prisma.TransactionClient, user: ProvenUser) => Promise<void>;
}): Promise<ProofResult> {
  return inTransaction(params.db, async (tx) => {
    // Finding the link only says whose it is (the owner and recipient never
    // change); whether it is still unused is decided by the conditional
    // spend below, after the account row is locked.
    const record = await tx.authToken.findFirst({
      where: { tokenHash: hashSecret(params.token), purpose: params.purpose },
      orderBy: { createdAt: "desc" },
      select: { id: true, userId: true, sentTo: true },
    });
    if (!record) return { ok: false, reason: "expired" };

    const user = await lockUser(tx, record.userId);
    if (!user || user.archivedAt || user.status === "disabled") return { ok: false, reason: "account" };

    const now = new Date();
    const spent = await tx.authToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (spent.count !== 1) return { ok: false, reason: "expired" };
    const recipient = record.sentTo ? normalizeEmail(record.sentTo) : null;
    if (!recipient) return { ok: false, reason: "no_recipient" };
    if (recipient !== normalizeEmail(user.email)) return { ok: false, reason: "address_changed" };

    await recordProof(tx, user, recipient);
    const proven: ProvenUser = { ...user };
    await params.onProven(tx, proven);
    return { ok: true, user: proven, verifiedEmail: recipient };
  });
}

/**
 * The account's email changed: every outstanding code and link was sent to
 * the old address and must never work again, and the old proof no longer
 * covers the new address. Run inside the transaction that changes the email.
 */
export async function forgetAddressProof(tx: Prisma.TransactionClient, userId: string) {
  const now = new Date();
  await tx.user.update({ where: { id: userId }, data: { verifiedEmail: null } });
  await tx.otpChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
  await tx.authToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
}
