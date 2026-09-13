import "server-only";

import type { TokenPurpose } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { generateToken, getBaseUrl, hashSecret } from "@/lib/security";

// One-time links: the invite that lets a newly created account set its first
// password, and the forgotten-password reset. Only the HMAC of the token is
// stored, so a database dump does not yield working links.

const INVITE_TTL_HOURS = Number(process.env.INVITE_TTL_HOURS || 168); // 7 days
const RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30);

export async function issueAuthToken(params: {
  userId: string;
  purpose: TokenPurpose;
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
    },
  });

  const path = params.purpose === "invite" ? "/activate" : "/reset-password";
  const url = `${getBaseUrl(params.req)}${path}?token=${token}`;

  return { token, url };
}

export async function consumeAuthToken(params: { token: string; purpose: TokenPurpose }) {
  const record = await prisma.authToken.findFirst({
    where: { tokenHash: hashSecret(params.token), purpose: params.purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
    include: { user: true },
  });

  if (!record || record.expiresAt <= new Date()) return null;
  return record;
}

