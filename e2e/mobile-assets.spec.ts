import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

test("cold screens load only visible brand artwork and never prefetch exports", async ({ page, context }, info) => {
  const fixtures = JSON.parse(fs.readFileSync(".mobile-qa/fixtures.json", "utf8"));
  const [, , locale, theme] = info.project.name.split("-");
  const origin = info.project.use.baseURL!;
  const user = fixtures.users.admin;
  const production = process.env.MOBILE_QA_PRODUCTION === "1";
  await context.addCookies([
    { name: "podium_locale", value: locale, url: origin },
    { name: "podium_theme", value: theme, url: origin },
    { name: production ? "__Secure-next-auth.session-token" : "next-auth.session-token", url: origin, secure: production,
      value: await encode({ secret: process.env.NEXTAUTH_SECRET!, token: { sub: user.id, ...user, status: "active", accessRoleId: null, locale, expiresAt: Date.now() + 3600000, refreshedAt: Date.now() } }) },
  ]);

  const requested = new Set<string>();
  page.on("request", (request) => requested.add(new URL(request.url()).pathname));
  await page.goto("/series/mobile-qa-live/registrations");
  await expect(page.locator("html")).toHaveAttribute("data-mobile-ready", "true");
  await expect(page.locator("[data-route-loading]")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  // Fonts retain their CSS faces and weights, but no longer all compete for
  // highest download priority before the navigation becomes interactive.
  await expect(page.locator('head link[rel="preload"][as="font"]')).toHaveCount(0);
  expect([...requested].filter((url) => url.includes("/export"))).toEqual([]);

  const mobile = info.project.use.viewport!.width <= 900;
  if (mobile) {
    expect([...requested].filter((url) => url.startsWith("/brand/"))).toEqual([]);
    await page.locator(".mobile-tabbar:visible > button").click();
  }
  const logo = page.locator(".console-brand img:visible");
  await expect(logo).toHaveCount(2);
  await expect.poll(() => logo.evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const suffix = theme === "light" ? "dark-on-light.png" : "light-on-dark.png";
  const images = await logo.evaluateAll((elements) => elements.map((element) => new URL((element as HTMLImageElement).currentSrc).pathname));
  expect(images).toEqual([`/brand/podium-${suffix}`, `/brand/bft-${suffix}`]);
  expect([...requested].filter((url) => url.startsWith("/brand/")).sort()).toEqual([...images].sort());
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `.mobile-qa/cold-assets-review/${info.project.name}.png` });

  if (mobile) {
    await page.locator(".mobile-menu-close:visible").click();
    await expect(page).toHaveURL(/\/registrations$/);
    await expect(page.locator(".console-nav")).not.toBeVisible();
  }
  const exportLink = page.locator('a[href="/api/series/mobile-qa-live/export"]');
  // The response's Content-Disposition starts the download, including in
  // WebKit; the anchor itself must not invoke the client page router.
  const download = page.waitForEvent("download", { timeout: 10_000 });
  await exportLink.click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await expect(page).toHaveURL(/\/registrations$/);
});
