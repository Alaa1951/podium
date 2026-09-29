/**
 * The throttle in front of sign-in, codes and password resets.
 *
 * It is the only thing standing between an automated password-guessing run and
 * an account, so the window arithmetic and the two independent keys (per IP and
 * per address) both matter. The bucket store lives on globalThis, so each test
 * uses its own key rather than trying to reset it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkRate, limitAuthAttempt, MINUTE_MS, NETWORK_LIMITS } from "@/lib/rate-limit";

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

describe("many athletes behind one network (a gym's Wi-Fi, the venue)", () => {
  it("lets forty different athletes on one address each ask for a code — the network is not one person", () => {
    const scope = uniqueScope();
    for (let n = 0; n < 40; n += 1) {
      expect(limitAuthAttempt({ scope, ip: "203.0.113.9", identifier: `athlete${n}@example.com`, limit: 5, networkLimit: NETWORK_LIMITS.codeRequest }).ok).toBe(true);
    }
  });

  it("still holds each ACCOUNT to its own allowance on that shared network", () => {
    const scope = uniqueScope();
    const ask = (who: string) => limitAuthAttempt({ scope, ip: "203.0.113.9", identifier: who, limit: 5, networkLimit: NETWORK_LIMITS.codeRequest }).ok;
    for (let n = 0; n < 5; n += 1) expect(ask("sara@example.com")).toBe(true);
    expect(ask("sara@example.com")).toBe(false); // the sixth for the same address
    expect(ask("mona@example.com")).toBe(true); // her neighbour on the same Wi-Fi is unaffected
  });

  it("…and the same account from ANOTHER network is still held to it (the address, not the network, is protected)", () => {
    const scope = uniqueScope();
    for (let n = 0; n < 5; n += 1) limitAuthAttempt({ scope, ip: `198.51.100.${n}`, identifier: "sara@example.com", limit: 5, networkLimit: 120 });
    expect(limitAuthAttempt({ scope, ip: "198.51.100.99", identifier: "sara@example.com", limit: 5, networkLimit: 120 }).ok).toBe(false);
  });

  it("caps one network as a whole, so a single address cannot sweep a mailing list", () => {
    const scope = uniqueScope();
    let allowed = 0;
    for (let n = 0; n < NETWORK_LIMITS.codeRequest + 10; n += 1) {
      if (limitAuthAttempt({ scope, ip: "203.0.113.50", identifier: `list${n}@example.com`, limit: 5, networkLimit: NETWORK_LIMITS.codeRequest }).ok) allowed += 1;
    }
    expect(allowed).toBe(NETWORK_LIMITS.codeRequest);
    // Another network is untouched.
    expect(limitAuthAttempt({ scope, ip: "203.0.113.51", identifier: "list0@example.com", limit: 5, networkLimit: NETWORK_LIMITS.codeRequest }).ok).toBe(true);
  });

  it("keeps the old single-number behaviour where no network limit is given", () => {
    const scope = uniqueScope();
    for (let n = 0; n < 3; n += 1) expect(limitAuthAttempt({ scope, ip: "203.0.113.60", identifier: `x${n}@example.com`, limit: 3 }).ok).toBe(true);
    expect(limitAuthAttempt({ scope, ip: "203.0.113.60", identifier: "x9@example.com", limit: 3 }).ok).toBe(false);
  });
});
