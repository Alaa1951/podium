import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), homeForUser: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser, homeForUser: mocks.homeForUser }));
vi.mock("@/lib/i18n/server", () => ({ getTranslator: async () => ({ t: (key: string) => key }) }));
vi.mock("@/components/auth/auth-shell", () => ({ AuthShell: () => null }));
vi.mock("@/components/auth/login-form", () => ({ LoginForm: () => null }));

import LoginPage from "./page";

const open = () => LoginPage({ searchParams: Promise.resolve({}), params: Promise.resolve({}) } as never);

beforeEach(() => vi.resetAllMocks());

// The store shells load /login on every launch. A signed-in person must land on
// their own home in one hop — "/" redirects non-admins only after streaming.
describe("signed-in app launch", () => {
  it.each([
    ["competitor", "/me"],
    ["studio", "/studio"],
    ["competitor", "/my-wave"],
    ["admin", "/"],
  ])("sends a %s straight to %s", async (role, home) => {
    const user = { id: "u1", role };
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.homeForUser.mockResolvedValue(home);
    await expect(open()).rejects.toThrow(`REDIRECT ${home}`);
    expect(mocks.homeForUser).toHaveBeenCalledWith(user);
  });

  it("shows the sign-in form without a session", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(open()).resolves.toBeTruthy();
    expect(mocks.homeForUser).not.toHaveBeenCalled();
  });
});
