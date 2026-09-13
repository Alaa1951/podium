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
 * Throttles per IP *and* per identifier, so neither one attacker address nor
 * one targeted account can be hammered.
 */
export function limitAuthAttempt(opts: {
  scope: string;
  ip?: string | null;
  identifier?: string | null;
  limit?: number;
  windowMs?: number;
}): RateResult {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;

  const ip = (opts.ip || "").trim() || "unknown";
  const byIp = checkRate(`auth:${opts.scope}:ip:${ip}`, limit, windowMs);
  if (!byIp.ok) return byIp;

  const identifier = (opts.identifier || "").trim().toLowerCase();
  if (identifier) {
    const byId = checkRate(`auth:${opts.scope}:id:${identifier}`, limit, windowMs);
    if (!byId.ok) return byId;
  }

  return { ok: true };
}
