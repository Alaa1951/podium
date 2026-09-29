import "server-only";

import type { TokenPurpose } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { peekAuthToken, spendAuthToken, type ProofResult, type ProvenUser } from "@/lib/auth-proof";
import { prisma } from "@/lib/prisma";
import { generateToken, getBaseUrl, hashSecret, normalizeEmail } from "@/lib/security";

// One-time links: the invite that lets a newly created account set its first
// password, and the forgotten-password reset. Only the HMAC of the token is
// stored, so a database dump does not yield working links. Each link records
// the address it went to and is honoured only while that is still the
// account's address (auth-proof.ts).

const INVITE_TTL_HOURS = Number(process.env.INVITE_TTL_HOURS || 168); // 7 days
const RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30);

export async function issueAuthToken(params: {
  userId: string;
  purpose: TokenPurpose;
  /** The address the link is about to be emailed to. */
  sentTo: string;
  req?: Request;
}) {
  const token = generateToken();
  const ttlMs =
    params.purpose === "invite" ? INVITE_TTL_HOURS * 3_600_000 : RESET_TTL_MINUTES * 60_000;

  // Any outstanding link of the same kind is spent — a second "resend" must
  // invalidate the first.
  await prisma.authToken.updateMany({
    where: { userId: params.userId, purpose: params.purpose, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.authToken.create({
    data: {
      userId: params.userId,
      tokenHash: hashSecret(token),
      purpose: params.purpose,
      expiresAt: new Date(Date.now() + ttlMs),
      sentTo: normalizeEmail(params.sentTo),
    },
  });

  const path = params.purpose === "invite" ? "/activate" : "/reset-password";
  const url = `${getBaseUrl(params.req)}${path}?token=${token}`;

  return { token, url };
}

/**
 * Whether a link can still be used — read only, for the page that shows the
 * form. The link is spent by `consumeAuthToken` when the form is submitted.
 */
export async function peekAuthLink(params: { token: string; purpose: TokenPurpose }) {
  return peekAuthToken(prisma, params);
}

/**
 * Spend a link. `apply` runs inside the transaction once the address is
 * proven; a refusal leaves the account exactly as it was.
 */
export async function consumeAuthToken(params: {
  token: string;
  purpose: TokenPurpose;
  apply: (tx: Prisma.TransactionClient, user: ProvenUser) => Promise<void>;
}): Promise<ProofResult> {
  return spendAuthToken({ db: prisma, token: params.token, purpose: params.purpose, onProven: params.apply });
}
