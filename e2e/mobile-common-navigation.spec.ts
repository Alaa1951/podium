import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

test("account and inbox retain role tabs; notification navigation protects drafts", async ({ page, context }, info) => {
  test.skip(!fs.existsSync(".mobile-qa/fixtures.json"), "Generate local mobile fixtures first.");
  const fixtures = JSON.parse(fs.readFileSync(".mobile-qa/fixtures.json", "utf8"));
  const [, width, locale, theme] = info.project.name.split("-");
  const origin = info.project.use.baseURL ?? "http://127.0.0.1:3100";
  const setup = async (role: string) => {
    await context.clearCookies();
    const user = fixtures.users[role];
    const value = await encode({ secret: process.env.NEXTAUTH_SECRET!, token: { sub: user.id, ...user, status: "active", accessRoleId: role === "limited" ? fixtures.accessRoleId : null, locale, expiresAt: Date.now() + 3600000, refreshedAt: Date.now() } });
    await context.addCookies([{ name: "podium_locale", value: locale, url: origin }, { name: "podium_theme", value: theme, url: origin }, { name: process.env.MOBILE_QA_PRODUCTION === "1" ? "__Secure-next-auth.session-token" : "next-auth.session-token", value, url: origin, secure: process.env.MOBILE_QA_PRODUCTION === "1" }]);
  };
  const errors: string[] = [];
  page.on("pageerror", error => {
    if (error.message.includes("127.0.0.1:3100") && error.message.includes("_rsc=") && error.message.endsWith("due to access control checks.")) return;
    errors.push(error.message);
  });
  for (const role of ["admin", "studio", "competitor", "limited"]) {
    await setup(role);
    for (const route of ["/account", "/notifications", "/notifications/mobile-e2e-notice-own"]) {
      // Let the bell's initial request finish before the next full navigation.
      // WebKit reports an aborted localhost HTTPS fetch as a page error even
      // when the component catches it; real fetch/JavaScript failures stay checked.
      const inboxResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/notifications" && response.request().method() === "GET" && response.status() === 200);
      expect((await page.goto(route))?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("data-mobile-ready", "true");
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
      await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--mobile-nav-h").trim().length > 0, undefined, { timeout: 15000 });
      const bar = page.locator(".personal-tabbar");
      if (Number(width) <= 900) {
        await expect(bar).toBeVisible();
        await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);
        const selected = role === "admin" ? "/?menu=more" : "/account";
        await expect(bar.locator('[aria-current="page"]')).toHaveAttribute("href", selected);
        await expect(bar.locator("a")).toHaveCount(role === "admin" || role === "competitor" ? 4 : 3);
        for (const link of await bar.locator("a").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      } else await expect(bar).toBeHidden();
      await expect(page.locator(".notification-bell:visible")).toHaveCount(1);
      expect(await (await inboxResponse).finished()).toBeNull();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      expect(errors).toEqual([]);
      if (role === "admin" && ["chromium-390-en-dark", "webkit-390-ar-light"].includes(info.project.name) && !route.includes("mobile-e2e")) {
        const folder = `.mobile-qa/screenshots/${info.project.name}`;
        fs.mkdirSync(folder, { recursive: true });
        await page.screenshot({ path: `${folder}/common-${route.slice(1)}_frame.png` });
      }
      fs.mkdirSync(".mobile-qa/coverage", { recursive: true });
      fs.appendFileSync(`.mobile-qa/coverage/${info.project.name}.jsonl`, JSON.stringify({ route, scenario: `${role}: common navigation`, status: 200, checkedAt: new Date().toISOString() }) + "\n");
    }
  }
  if (info.project.name === "chromium-390-en-dark") {
    await setup("admin");
    const live = fixtures.series.find((item: { status: string }) => item.status === "live");
    const score = `/series/${live.slug}/scores/${live.teams[0]}`;
    await page.goto(score);
    await expect(page.locator("html")).toHaveAttribute("data-mobile-ready", "true");
    const value = page.locator(".team-entry-count-value").first(), before = Number(await value.textContent());
    await page.locator(".team-entry-stepper").first().click();
    await expect(value).toHaveText(String(before + 1));
    let prompts = 0;
    page.on("dialog", async dialog => { prompts++; await dialog.dismiss(); });
    await page.locator(".notification-bell").click();
    await expect(page).toHaveURL(new RegExp(`${score}$`));
    expect(prompts).toBe(1);
    await expect(value).toHaveText(String(before + 1));
  }
});
