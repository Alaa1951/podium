/**
 * The in-session "change my password" door.
 *
 * What is pinned here is the property the old current-password form used to
 * provide and this route has to provide differently: the link goes to the
 * session's own mailbox and nowhere else, and nothing about the request can
 * redirect it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  rate: vi.fn(),
  issue: vi.fn(),
  send: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/rate-limit", () => ({ limitAuthAttempt: mocks.rate }));
vi.mock("@/lib/auth-tokens", () => ({ issueAuthToken: mocks.issue }));
vi.mock("@/lib/email", () => ({ sendPasswordResetEmail: mocks.send }));
vi.mock("@/lib/audit", () => ({
  recordAudit: mocks.audit,
  AUDIT: { passwordResetRequested: "security.password_reset_requested" },
}));
vi.mock("@/lib/security", () => ({ getIpFromHeaders: () => "203.0.113.7" }));

import { POST } from "@/app/api/auth/request-password-reset/route";

const request = () => new Request("https://podium.test/api/auth/request-password-reset", { method: "POST" });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rate.mockReturnValue({ ok: true });
  mocks.issue.mockResolvedValue({ token: "t", url: "https://podium.test/reset-password?token=t" });
  mocks.send.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
});

describe("requesting a password reset from inside a session", () => {
  it("emails the session's own address and never asks for a current password", async () => {
    mocks.user.mockResolvedValue({ id: "u1", email: "coach@studio.com" });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.issue).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", purpose: "reset" }));
    expect(mocks.send).toHaveBeenCalledWith({
      email: "coach@studio.com",
      url: "https://podium.test/reset-password?token=t",
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "u1", action: "security.password_reset_requested" })
    );
  });

  it("refuses a caller with no session before issuing anything", async () => {
    mocks.user.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("throttles per address and per network, and mints no token when it does", async () => {
    mocks.user.mockResolvedValue({ id: "u1", email: "coach@studio.com" });
    mocks.rate.mockReturnValue({ ok: false, retryAfter: 42 });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(mocks.rate).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "request-password-reset", identifier: "coach@studio.com" })
    );
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("reports a failed send without leaking why, and records no audit for it", async () => {
    mocks.user.mockResolvedValue({ id: "u1", email: "coach@studio.com" });
    mocks.send.mockRejectedValue(new Error("SMTP_HOST unreachable at 10.0.0.1"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, error: "EMAIL_SEND_FAILED" });
    expect(mocks.audit).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
