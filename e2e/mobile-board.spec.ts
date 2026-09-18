import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
const fixtureFile = ".mobile-qa/fixtures.json";

test("live board retains app navigation for every role and desktop wall display", async ({ page, context }, info) => {
  test.skip(!fs.existsSync(fixtureFile), "Generate local mobile fixtures first.");
  const fixtures = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
  const live = fixtures.series.find((item: { status: string }) => item.status === "live");
  const [, width, locale, theme] = info.project.name.split("-");
  const localURL = info.project.use.baseURL ?? "http://127.0.0.1:3100";
  const errors: string[] = [];
  page.on("pageerror", error => {
    if (error.message.includes("127.0.0.1:3100") && error.message.includes("_rsc=") && error.message.endsWith("due to access control checks.")) return;
    errors.push(error.message);
  });
  for (const role of ["admin", "studio", "competitor", "limited"]) {
    await context.clearCookies();
    const user = fixtures.users[role];
    const value = await encode({ secret: process.env.NEXTAUTH_SECRET!, token: { sub: user.id, ...user, status: "active", accessRoleId: role === "limited" ? fixtures.accessRoleId : null, locale, expiresAt: Date.now() + 3600000, refreshedAt: Date.now() } });
    await context.addCookies([
      { name: "podium_locale", value: locale, url: localURL },
      { name: "podium_theme", value: theme, url: localURL },
      { name: process.env.MOBILE_QA_PRODUCTION === "1" ? "__Secure-next-auth.session-token" : "next-auth.session-token", value, url: localURL, secure: process.env.MOBILE_QA_PRODUCTION === "1" },
    ]);
    expect((await page.goto(`/series/${live.slug}/board`))?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("data-mobile-ready", "true");
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--mobile-nav-h").trim().length > 0, undefined, {timeout:15_000});
    await page.evaluate(() => document.fonts.ready);
    const mobile = Number(width) <= 900;
    if (mobile) {
      await expect(page.locator(".board-frame-bar")).toBeHidden();
      await expect(page.locator(".mobile-tabbar:visible")).toHaveCount(1);
      await expect(page.locator(".notification-bell:visible")).toHaveCount(1);
      await expect(page.locator('.mobile-tabbar [data-active="true"]:visible')).toHaveCount(1);
      if (role === "admin" || role === "studio" || role === "limited") {
        const prefix = role === "admin" ? "/series" : "/studio";
        await expect(page.locator(".mobile-heading-title")).toHaveAttribute("href", `${prefix}/${live.slug}`);
        if (role === "limited") {
          await expect(page.locator('.mobile-tabbar a[href$="/scores"]')).toHaveCount(1);
          await expect(page.locator('.mobile-tabbar a[href$="/teams"]')).toHaveCount(0);
          await expect(page.locator('.mobile-tabbar a[href$="/waves"]')).toHaveCount(0);
        }
      }
      for (const target of await page.locator(".mobile-tabbar a:visible,.mobile-tabbar button:visible,.mobile-heading-title:visible,.mobile-back:visible").all()) {
        expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      }
      if (role === "admin") {
        await page.locator('.board-filters > button').click();
        await expect(page.locator('.board-filters dialog')).toBeVisible();
        expect(await page.locator('.board-filters dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await page.locator('.board-filters dialog button[data-mobile-dismiss]').click();
        await expect(page.locator('.board-filters dialog')).toBeHidden();
      }
    } else {
      await expect(page.locator(".board-frame-bar")).toBeVisible();
      await expect(page.locator(".mobile-tabbar:visible")).toHaveCount(0);
      await expect(page.locator(".console-nav")).toHaveCount(0);
    }
    const overflow = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("body *")).filter(el => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      if (style.display === "none" || style.position === "absolute" || rect.width <= 1 || el.closest('dialog:not([open]),[hidden],thead')) return false;
      if (document.documentElement.clientWidth > 900 && el.closest(".table-scroll,.sponsor-track")) return false;
      return rect.left < -1 || rect.right > document.documentElement.clientWidth + 1;
    }).map(el => `${el.tagName}.${el.className}`));
    expect(overflow, role).toEqual([]);
    expect(errors, role).toEqual([]);
    fs.mkdirSync(".mobile-qa/coverage", { recursive: true });
    fs.appendFileSync(`.mobile-qa/coverage/${info.project.name}.jsonl`, JSON.stringify({ route: `/series/${live.slug}/board`, scenario: `${role}: live board app navigation`, status: 200, checkedAt: new Date().toISOString() }) + "\n");
    if (["chromium-390-en-dark", "webkit-390-ar-light", "chromium-1024-en-dark"].includes(info.project.name)) {
      const folder = `.mobile-qa/screenshots/${info.project.name}`;
      fs.mkdirSync(folder, { recursive: true });
      await page.screenshot({ path: `${folder}/board_${role}_frame.png` });
    }
  }
  if (Number(width) === 1024) {
    // Exercise Capacitor's layout branch, without claiming a native bridge/device.
    await context.addInitScript(() => {
      const surface = window as unknown as Record<string, unknown>;
      surface.CapacitorCustomPlatform = { name: "ios" };
      surface.Capacitor = { isNativePlatform: () => true };
    });
    await page.goto(`/series/${live.slug}/board`);
    await expect(page.locator("html")).toHaveAttribute("data-native", "true");
    await expect(page.locator(".mobile-tabbar:visible")).toHaveCount(1);
    await expect(page.locator(".console-nav")).toBeHidden();
    await expect(page.locator(".board-frame-bar")).toBeHidden();
    await expect(page.locator('.mobile-tabbar a[href$="/scores"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  }
});
