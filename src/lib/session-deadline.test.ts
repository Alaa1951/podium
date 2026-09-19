import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NEXTAUTH_SECRET ||= "test-secret-not-used-anywhere-real"; });
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn().mockResolvedValue(null) } } }));
vi.mock("@/lib/auth-providers", () => ({ providers: [] }));

import { authOptions } from "@/lib/auth";
import { nextSessionDeadline, SESSION_IDLE_MS } from "@/lib/session-deadline";

const DAY = 24 * 3_600_000;
type Jwt = NonNullable<NonNullable<typeof authOptions.callbacks>["jwt"]>;
const jwt = authOptions.callbacks!.jwt! as (args: Partial<Parameters<Jwt>[0]>) => Promise<Record<string, unknown>>;

describe("staying signed in", () => {
  it("lasts 30 days from the last use", () => {
    expect(SESSION_IDLE_MS).toBe(30 * DAY);
    expect(nextSessionDeadline(1_000 + DAY, 1_000)).toBe(1_000 + 30 * DAY);
  });

  it("never revives an expired session", () => {
    expect(nextSessionDeadline(500, 1_000)).toBe(500);
  });

  it("starts a deadline for a token that has none", () => {
    expect(nextSessionDeadline(undefined, 1_000)).toBe(1_000 + 30 * DAY);
  });

  it.each(["admin", "studio", "competitor"])("gives a %s the same 30 days at sign-in", async (role) => {
    const token = await jwt({ token: {}, user: { id: "u1", role, status: "active" } as never });
    expect(token.expiresAt as number).toBeGreaterThan(Date.now() + 29 * DAY);
  });

  it("moves the deadline forward when the app is opened again", async () => {
    const token = await jwt({ token: { sub: "u1", expiresAt: Date.now() + DAY, refreshedAt: Date.now() } });
    expect(token.expiresAt as number).toBeGreaterThan(Date.now() + 29 * DAY);
  });

  it("keeps a session that already expired expired", async () => {
    const expired = Date.now() - 1_000;
    const token = await jwt({ token: { sub: "u1", expiresAt: expired, refreshedAt: Date.now() } });
    expect(token.expiresAt).toBe(expired);
  });

  it("keeps the cookie as long as the session", () => {
    expect(authOptions.session?.maxAge).toBe(30 * 24 * 3_600);
    expect(authOptions.cookies?.sessionToken?.options.maxAge).toBe(30 * 24 * 3_600);
  });
});
