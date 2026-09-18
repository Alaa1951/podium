import { test, expect, type BrowserContext, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";
import { signViewAs, VIEW_AS_COOKIE } from "../src/lib/view-as-token";

loadEnvConfig(process.cwd());

async function signIn(context: BrowserContext, info: TestInfo) {
  const origin = info.project.use.baseURL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Local fixture sessions only");
  const fixture = JSON.parse(fs.readFileSync(".mobile-qa/fixtures.json", "utf8"));
  const user = fixture.users.admin;
  await context.addCookies([
    { name: "podium_locale", value: "en", url: origin },
    { name: process.env.MOBILE_QA_PRODUCTION === "1" ? "__Secure-next-auth.session-token" : "next-auth.session-token", url: origin,
      secure: process.env.MOBILE_QA_PRODUCTION === "1", value: await encode({ secret: process.env.NEXTAUTH_SECRET!,
        token: { sub: user.id, ...user, status: "active", accessRoleId: null, locale: "en", expiresAt: Date.now() + 3600000, refreshedAt: Date.now() } }) },
  ]);
  return fixture;
}

test("tab navigation never downloads the closed inbox and focus events share one count request", async ({ page, context }, info) => {
  await signIn(context, info);
  const requests: string[] = [];
  await page.route("**/api/notifications*", async route => {
    requests.push(route.request().url());
    // Focus and visibility events must coalesce even while a response is slow.
    await new Promise(resolve => setTimeout(resolve, 200));
    await route.continue();
  });
  const first = page.waitForResponse(response => response.url().includes("/api/notifications?summary=1"));
  await page.goto("/series/mobile-qa-live/registrations");
  await (await first).finished();
  await expect(page.locator(".notification-bell:visible")).toBeVisible();
  const initial = requests.length;
  for (const section of ["waves", "scores", "results"]) {
    const selector = info.project.use.viewport!.width <= 900 ? ".mobile-tabbar:visible" : ".console-nav";
    await page.locator(`${selector} a[href="/series/mobile-qa-live/${section}"]`).click();
    await expect(page).toHaveURL(`/series/mobile-qa-live/${section}`);
    await expect(page.locator("[data-route-loading]")).toHaveCount(0);
  }
  expect(requests.length).toBe(initial);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(350);
  expect(requests.length).toBeLessThanOrEqual(initial + 1);
  expect(requests.every(url => new URL(url).searchParams.get("summary") === "1")).toBe(true);
});

test("desktop inbox loads on opening, confirms reads, and discards messages across preview scope changes", async ({ page, context }, info) => {
  test.skip(info.project.use.viewport!.width <= 900, "Desktop panel; mobile inbox is its own server-rendered screen.");
  const fixture = await signIn(context, info);
  let unread = 1;
  let fullRequests = 0;
  let summaryRequests = 0;
  let holdSummary: (() => void) | undefined;
  let holdNextSummary = false;
  const own = "mobile-e2e-notice-own";
  await page.route("**/api/notifications*", async route => {
    const summary = new URL(route.request().url()).searchParams.get("summary") === "1";
    if (summary) {
      summaryRequests++;
      const capturedCount = unread;
      if (holdNextSummary) {
        holdNextSummary = false;
        await new Promise<void>(resolve => { holdSummary = resolve; });
      }
      await route.fulfill({ json: { unreadCount: capturedCount, readOnly: false, scopeKey: "admin" } });
    } else {
      fullRequests++;
      await route.fulfill({ json: { unreadCount: unread, readOnly: false, scopeKey: "admin", nextCursor: null,
        items: [{ id: own, title: "Count regression fixture", body: "Displayed only after opening", createdAt: new Date().toISOString(), read: unread === 0 }] } });
    }
  });
  page.on("response", response => {
    // This is a real, idempotent receipt write on the existing LOCAL fixture.
    // Only a confirmed action response changes the subsequent mocked count.
    if (response.request().method() === "POST" && response.request().headers()["next-action"] && response.ok()) unread = 0;
  });
  await page.goto("/series/mobile-qa-live/registrations");
  const bell = page.locator(".notification-bell:visible");
  await expect(bell).toHaveAttribute("aria-label", "Notifications, 1 unread");
  expect(fullRequests).toBe(0);
  await bell.click();
  await expect(page.locator(".notification-dialog")).toContainText("Displayed only after opening");
  expect(fullRequests).toBe(1);

  // An older summary must not overwrite the count returned after a confirmed read.
  holdNextSummary = true;
  await page.evaluate(() => window.dispatchEvent(new Event("podium:notifications-changed")));
  await expect.poll(() => !!holdSummary).toBe(true);
  await page.locator(".notification-dialog").getByRole("button", { name: "Mark as read", exact: true }).click();
  await expect(bell).toHaveAttribute("aria-label", "Notifications, 0 unread");
  holdSummary!();
  await page.waitForTimeout(200);
  await expect(bell).toHaveAttribute("aria-label", "Notifications, 0 unread");
  expect(fullRequests).toBe(2);
  expect(summaryRequests).toBe(2);

  // Simulate a client history transition while the dialog is open.
  await page.evaluate(() => history.pushState(null, "", "/series/mobile-qa-live/waves"));
  await expect(page.locator(".notification-dialog")).not.toBeVisible();
  await page.unroute("**/api/notifications*");
  await context.addCookies([{ name: VIEW_AS_COOKIE, url: info.project.use.baseURL!, value: signViewAs(fixture.users.studio.id, Date.now() + 3600000, process.env.OTP_SECRET || process.env.NEXTAUTH_SECRET!) }]);
  await page.goto("/studio/mobile-qa-live/teams");
  await expect(bell).toBeVisible();
  const feed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/notifications" && !new URL(response.url()).searchParams.has("summary"));
  await bell.click();
  const fresh = await (await feed).json();
  expect(fresh.readOnly).toBe(true);
  expect(JSON.parse(fresh.scopeKey)[0]).toBe(fixture.users.studio.id);
  await expect(page.locator(".notification-dialog")).not.toContainText("Displayed only after opening");
  await expect(page.locator(".notification-dialog").getByRole("button", { name: "Mark shown as read", exact: true })).toBeDisabled();
});
