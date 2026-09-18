import { expect, test, type BrowserContext, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";
import { signViewAs, VIEW_AS_COOKIE } from "../src/lib/view-as-token";

loadEnvConfig(process.cwd());

async function installShell(context: BrowserContext, info: TestInfo, platform: "ios" | "android") {
  const fixtures = JSON.parse(fs.readFileSync(".mobile-qa/fixtures.json", "utf8"));
  const [, , locale, theme] = info.project.name.split("-");
  const url = info.project.use.baseURL!;
  const user = fixtures.users.admin;
  await context.addCookies([
    { name: "podium_locale", value: locale, url }, { name: "podium_theme", value: theme, url },
    { name: process.env.MOBILE_QA_PRODUCTION === "1" ? "__Secure-next-auth.session-token" : "next-auth.session-token", url,
      secure: process.env.MOBILE_QA_PRODUCTION === "1", value: await encode({ secret: process.env.NEXTAUTH_SECRET!, token: { sub: user.id, ...user, status: "active", accessRoleId: null, locale, expiresAt: Date.now() + 3600000, refreshedAt: Date.now() } }) },
  ]);
  await context.addInitScript((platform) => {
    const surface = window as typeof window & { CapacitorCustomPlatform?: { name: string }; Capacitor?: unknown; __statusHeight?: number };
    surface.CapacitorCustomPlatform = { name: platform };
    surface.__statusHeight = 59;
    // Model only the existing official bridge API. App/Keyboard intentionally
    // absent: unavailable unrelated plugins must not break inset measurement.
    surface.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => platform,
      PluginHeaders: [{ name: "StatusBar", methods: [{ name: "getInfo", rtype: "promise" }, { name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "promise" }] }],
      nativePromise: async () => ({ visible: true, overlays: true, height: surface.__statusHeight }),
      nativeCallback: () => "safe-area-test-listener",
    };
    Object.defineProperty(window, "orientation", { value: 0, configurable: true });
    if (platform === "android") {
      // Capacitor SystemBars supplies CSS variables when env() is zero.
      const inject = () => {
        document.documentElement.style.setProperty("--safe-area-inset-top", "36px");
        document.documentElement.style.setProperty("--safe-area-inset-bottom", "24px");
      };
      if (document.documentElement) inject(); else document.addEventListener("DOMContentLoaded", inject, { once: true });
    }
  }, platform);
}

for (const platform of ["ios", "android"] as const) {
  test(`${platform} measured system inset protects all page shells`, async ({ page, context }, info) => {
    await installShell(context, info, platform);
    const top = platform === "ios" ? 59 : 36;
    // Console, header outside console, board, public, and plain error/loading
    // paths share the document boundary rather than per-screen guessed values.
    for (const route of ["/series/mobile-qa-live/waves", "/account", "/series/mobile-qa-live/board", "/privacy", "/not-a-podium-page"]) {
      await page.goto(route);
      await expect(page.locator("html")).toHaveAttribute("data-native", "true");
      await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingTop))).toBeGreaterThanOrEqual(top);
      if (platform === "ios") await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--ios-safe-top"))).toBe("0px");
      if (route.startsWith("/series/") || route === "/account") await expect(page.locator(".mobile-tabbar:visible")).toHaveCount(1);
      const header = page.locator(".console-inbox-head:visible, .plain-header:visible");
      if (await header.count()) {
        for (const y of [0, 2000, 0]) {
          await page.evaluate(scroll => window.scrollTo(0, scroll), y);
          expect((await header.first().boundingBox())!.y).toBe(top);
          const back = page.locator(".mobile-back:visible").first();
          if (await back.count()) expect((await back.boundingBox())!.y).toBeGreaterThanOrEqual(top);
        }
      }
      expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body, "::before").height))).toBe(top);
    }
    await context.clearCookies();
    await page.goto("/login");
    await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingTop))).toBe(top);
    expect((await page.locator(".auth-shell").boundingBox())!.y).toBe(top);
    // Orientation/keyboard resize must re-read the official native reading.
    if (platform === "ios") {
      await page.evaluate(() => { (window as typeof window & { __statusHeight?: number }).__statusHeight = 20; window.dispatchEvent(new Event("resize")); });
      await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingTop))).toBe(20);
    }
  });

  test(`${platform} account offset survives a retained hidden console`, async ({ page, context }, info) => {
    await installShell(context, info, platform);
    await page.goto("/account");
    await expect(page.locator(".native-header-spacer")).toBeVisible();
    await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingTop))).toBe(platform === "ios" ? 59 : 36);
    const before = (await page.locator(".page-shell").boundingBox())!.y;
    // Next retains previous screens during client navigation. This used to
    // change body's :has() branch and pull the next form under the header.
    await page.evaluate(() => {
      const retained = document.createElement("div"); retained.hidden = true;
      retained.innerHTML = '<main class="console"><div class="console-main"></div></main>';
      document.body.appendChild(retained);
    });
    expect((await page.locator(".page-shell").boundingBox())!.y).toBe(before);
    expect(before).toBeGreaterThanOrEqual((platform === "ios" ? 59 : 36) + 60);
    await expect(page.locator(".personal-tabbar")).toBeVisible();
    await expect(page.locator(".mobile-tabbar:visible")).toHaveCount(1);
    const folder = `.mobile-qa/inset-review/${info.project.name}`;
    fs.mkdirSync(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/${platform}-account.png` });
  });

  test(`${platform} full-screen dialog scrolls below the status bar`, async ({ page, context }, info) => {
    await installShell(context, info, platform);
    await page.goto("/account");
    const top = platform === "ios" ? 59 : 36;
    await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.body, "::before").height))).toBe(top);
    await page.locator(".notification-dialog").evaluate((element: HTMLDialogElement) => {
      element.insertAdjacentHTML("beforeend", '<div style="height:2000px">Long notification list</div>');
      element.showModal();
    });
    // WebKit finishes modal focus/scroll restoration after showModal returns.
    // Scroll the visible dialog as a user would, after its layout has settled.
    await expect(page.locator(".notification-dialog")).toBeVisible();
    await page.locator(".notification-dialog").hover();
    await page.mouse.wheel(0, 1000);
    await expect.poll(() => page.locator(".notification-dialog").evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const bounds = (await page.locator(".notification-dialog").boundingBox())!;
    expect(bounds.y).toBe(top);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(info.project.use.viewport!.height + 1);
    expect(await page.locator(".notification-dialog").evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  });

  test(`${platform} preview exit remains below the header and preview remains read-only`, async ({ page, context }, info) => {
    await installShell(context, info, platform);
    const fixtures = JSON.parse(fs.readFileSync(".mobile-qa/fixtures.json", "utf8"));
    await context.addCookies([{ name: VIEW_AS_COOKIE, url: info.project.use.baseURL!,
      value: signViewAs(fixtures.users.studio.id, Date.now() + 3600000, process.env.OTP_SECRET || process.env.NEXTAUTH_SECRET!) }]);
    await page.goto("/studio/mobile-qa-live/teams");
    const banner = page.locator(".view-as-banner:visible");
    await expect(banner).toBeVisible();
    await expect(banner.locator("strong")).toHaveText(/Read-only preview|معاينة للقراءة بس/);
    const exit = page.locator(".view-as-banner-exit:visible");
    await expect.poll(async () => {
      const header = (await page.locator(".console-inbox-head:visible").boundingBox())!;
      return (await exit.boundingBox())!.y - (header.y + header.height);
    }).toBeGreaterThanOrEqual(0);
    expect(await exit.evaluate(element => { const bounds = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)); })).toBe(true);
    const team = fixtures.series.find((series: { status: string }) => series.status === "live").teams[0];
    await page.goto(`/studio/mobile-qa-live/scores/${team}`);
    await expect(page.locator(".team-entry-save:visible")).toBeDisabled();
    // The QA build's canonical origin must match baseURL, or its local HTTPS
    // proxy must map that origin's Location header. Exercise the real GET and
    // cookie removal; WebKit cannot mock a document redirect via route.fulfill.
    const exitResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/view-as/exit");
    await page.locator(".view-as-banner-exit:visible").click();
    expect((await exitResponse).status()).toBe(307);
    await expect(page).toHaveURL(new URL("/", info.project.use.baseURL!).href);
    await expect.poll(async () => (await context.cookies()).some(cookie => cookie.name === VIEW_AS_COOKIE)).toBe(false);
    await expect(page.locator(".view-as-banner:visible")).toHaveCount(0);
  });
}
