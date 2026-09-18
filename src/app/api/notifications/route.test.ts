import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), summary: vi.fn(), feed: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  getNotificationUser: mocks.user, getNotificationSummary: mocks.summary, listNotifications: mocks.feed,
}));
import { GET } from "@/app/api/notifications/route";

beforeEach(() => vi.resetAllMocks());

describe("notification summary API", () => {
  it("performs fresh authority checks and never reads message content for a badge", async () => {
    const user = { id: "server-resolved-user", role: "studio", studioId: "own" };
    mocks.user.mockResolvedValue(user);
    mocks.summary.mockResolvedValue({ unreadCount: 4, readOnly: false, scopeKey: "own" });
    const response = await GET(new Request("https://podium.test/api/notifications?summary=1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unreadCount: 4, readOnly: false, scopeKey: "own" });
    expect(mocks.user).toHaveBeenCalledOnce();
    expect(mocks.summary).toHaveBeenCalledWith(user);
    expect(mocks.feed).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
  });

  it("refuses an inactive account before reading a badge count", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(new Request("https://podium.test/api/notifications?summary=1"))).status).toBe(401);
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it("retains the full scoped feed and cursor checks when explicitly requested", async () => {
    const user = { id: "server-resolved-user" };
    mocks.user.mockResolvedValue(user);
    mocks.feed.mockResolvedValue(null);
    const response = await GET(new Request("https://podium.test/api/notifications?cursor=other-studio"));
    expect(response.status).toBe(400);
    expect(mocks.feed).toHaveBeenCalledWith(user, "other-studio");
    expect(mocks.summary).not.toHaveBeenCalled();
  });
});
