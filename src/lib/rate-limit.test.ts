/**
 * The throttle in front of sign-in, codes and password resets.
 *
 * It is the only thing standing between an automated password-guessing run and
 * an account, so the window arithmetic and the two independent keys (per IP and
 * per address) both matter. The bucket store lives on globalThis, so each test
 * uses its own key rather than trying to reset it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkRate, limitAuthAttempt, MINUTE_MS } from "@/lib/rate-limit";

let counter = 0;
const uniqueScope = () => `test-scope-${counter++}-${Math.random().toString(36).slice(2)}`;

beforeEach(() => {
  vi.useRealTimers();
});

describe("checkRate", () => {
  it("allows up to the limit and refuses the next", () => {
    const key = uniqueScope();
    expect(checkRate(key, 3, MINUTE_MS).ok).toBe(true);
    expect(checkRate(key, 3, MINUTE_MS).ok).toBe(true);
    expect(checkRate(key, 3, MINUTE_MS).ok).toBe(true);

    const refused = checkRate(key, 3, MINUTE_MS);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.retryAfter).toBeGreaterThan(0);
  });

  it("reports how long to wait, in seconds", () => {
    const key = uniqueScope();
    checkRate(key, 1, 30_000);
    const refused = checkRate(key, 1, 30_000);
    expect(refused.ok === false && refused.retryAfter).toBeLessThanOrEqual(30);
  });

  it("opens a fresh window once the old one has passed", () => {
    vi.useFakeTimers();
    const key = uniqueScope();

    expect(checkRate(key, 2, 60_000).ok).toBe(true);
    expect(checkRate(key, 2, 60_000).ok).toBe(true);
    expect(checkRate(key, 2, 60_000).ok).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(checkRate(key, 2, 60_000).ok).toBe(true);
  });

  it("keeps separate keys separate", () => {
    const a = uniqueScope();
    const b = uniqueScope();
    checkRate(a, 1, MINUTE_MS);
    expect(checkRate(a, 1, MINUTE_MS).ok).toBe(false);
    expect(checkRate(b, 1, MINUTE_MS).ok).toBe(true);
  });
});

describe("limitAuthAttempt", () => {
  it("throttles one address across different addresses from the same IP", () => {
    const scope = uniqueScope();
    for (let i = 0; i < 5; i++) {
      expect(limitAuthAttempt({ scope, ip: "1.1.1.1", identifier: `a${i}@x.com`, limit: 5 }).ok).toBe(
        true
      );
    }
    // The IP bucket is spent even though every address was new — this is the
    // case that matters for credential stuffing.
    expect(
      limitAuthAttempt({ scope, ip: "1.1.1.1", identifier: "fresh@x.com", limit: 5 }).ok
    ).toBe(false);
  });

  it("throttles one address across different IPs", () => {
    const scope = uniqueScope();
    for (let i = 0; i < 5; i++) {
      expect(
        limitAuthAttempt({ scope, ip: `10.0.0.${i}`, identifier: "target@x.com", limit: 5 }).ok
      ).toBe(true);
    }
    // A distributed run against one account is caught by the identifier bucket.
    expect(
      limitAuthAttempt({ scope, ip: "10.0.0.99", identifier: "target@x.com", limit: 5 }).ok
    ).toBe(false);
  });

  it("treats a missing IP as one shared bucket rather than as no limit", () => {
    const scope = uniqueScope();
    for (let i = 0; i < 3; i++) {
      expect(limitAuthAttempt({ scope, ip: null, identifier: `b${i}@x.com`, limit: 3 }).ok).toBe(
        true
      );
    }
    expect(limitAuthAttempt({ scope, ip: null, identifier: "c@x.com", limit: 3 }).ok).toBe(false);
  });

  it("matches an address regardless of case or padding", () => {
    const scope = uniqueScope();
    limitAuthAttempt({ scope, ip: "2.2.2.2", identifier: "Same@X.com", limit: 2 });
    limitAuthAttempt({ scope, ip: "3.3.3.3", identifier: "  same@x.com  ", limit: 2 });
    expect(limitAuthAttempt({ scope, ip: "4.4.4.4", identifier: "SAME@x.com", limit: 2 }).ok).toBe(
      false
    );
  });

  it("keeps scopes independent, so a reset flood does not lock out sign-in", () => {
    const login = uniqueScope();
    const reset = uniqueScope();
    limitAuthAttempt({ scope: reset, ip: "5.5.5.5", identifier: "x@x.com", limit: 1 });
    expect(limitAuthAttempt({ scope: reset, ip: "5.5.5.5", identifier: "x@x.com", limit: 1 }).ok).toBe(
      false
    );
    expect(limitAuthAttempt({ scope: login, ip: "5.5.5.5", identifier: "x@x.com", limit: 1 }).ok).toBe(
      true
    );
  });
});
