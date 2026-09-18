import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

describe("public installation assets", () => {
  it.each(["/sw.js", "/manifest.webmanifest"])("serves %s without a login redirect and retains security headers", path => {
    const response = proxy(new NextRequest(`https://podium.example${path}`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.get("content-security-policy")).toContain("worker-src 'self'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it.each(["/sw.js/private", "/manifest.webmanifest/private", "/account", "/notifications"])("keeps %s behind sign-in", path => {
    const response = proxy(new NextRequest(`https://podium.example${path}`));
    expect(response.status).toBe(307);
    const redirect = new URL(response.headers.get("location")!);
    expect(redirect.pathname).toBe("/login");
    expect(redirect.searchParams.get("callbackUrl")).toBe(path);
  });

  it("keeps the private inbox API protected", () => {
    const response = proxy(new NextRequest("https://podium.example/api/notifications"));
    expect(response.status).toBe(401);
  });
});
