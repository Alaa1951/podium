import "server-only";

// Fixed-window throttle for the sensitive auth endpoints. In-memory, so it is
// correct only for a single process — which is what this deployment is. Move to
// a shared store (Redis, or a MySQL table) before running more than one
// instance, otherwise the limit multiplies by the instance count.

type Bucket = { count: number; windowStart: number };

const buckets: Map<string, Bucket> = (() => {
  const g = globalThis as unknown as { __pdRateBuckets?: Map<string, Bucket> };
  if (!g.__pdRateBuckets) g.__pdRateBuckets = new Map();
  return g.__pdRateBuckets;
})();

export const MINUTE_MS = 60_000;

export type RateResult = { ok: true } | { ok: false; retryAfter: number };

export function checkRate(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    // Opportunistic sweep so a long-running process does not accumulate keys.
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) {
        if (now - b.windowStart >= windowMs) buckets.delete(k);
      }
    }
    return { ok: true };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.windowStart + windowMs - now) / 1000) };
  }

  bucket.count += 1;
  return { ok: true };
}

const DEFAULT_WINDOW_MS = 15 * MINUTE_MS;
const DEFAULT_LIMIT = 10;

/**
 * Per-network allowances, per 15 minutes. Sized for a crowd behind one
 * address (a gym's members, the venue Wi-Fi at check-in); each person still
 * gets only their own per-account allowance inside it.
 */
export const NETWORK_LIMITS = {
  /** Asking for a sign-in code: at most 5 per address, 120 per network. */
  codeRequest: 120,
  /** Typing a sign-in code: at most 10 per address, 300 per network. */
  codeEntry: 300,
  /** Password sign-in and its emailed second step. */
  passwordSignIn: 120,
  /** Forgotten password, resend, "email me a link", set a password. */
  emailedLink: 60,
} as const;

/**
 * Throttles per IP *and* per identifier, so neither one attacker address nor
 * one targeted account can be hammered.
 *
 * The two are separate numbers. `limit` guards ONE account (an address, an
 * email): that is what stops a code being guessed or a mailbox being
 * flooded. `networkLimit` guards one network, and a network is often many
 * people — a gym's Wi-Fi, the venue on competition day, a mobile carrier's
 * shared address — so it is set for a crowd, not a person. Without it the
 * whole network would share one person's allowance.
 */
export function limitAuthAttempt(opts: {
  scope: string;
  ip?: string | null;
  identifier?: string | null;
  /** Per account (identifier). */
  limit?: number;
  /** Per network (IP); defaults to `limit`. */
  networkLimit?: number;
  windowMs?: number;
}): RateResult {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const networkLimit = opts.networkLimit ?? limit;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;

  const ip = (opts.ip || "").trim() || "unknown";
  const byIp = checkRate(`auth:${opts.scope}:ip:${ip}`, networkLimit, windowMs);
  if (!byIp.ok) return byIp;

  const identifier = (opts.identifier || "").trim().toLowerCase();
  if (identifier) {
    const byId = checkRate(`auth:${opts.scope}:id:${identifier}`, limit, windowMs);
    if (!byId.ok) return byId;
  }

  return { ok: true };
}
