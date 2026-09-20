/**
 * The phone's "More" menu has to reach its own bottom.
 *
 * `.console-nav` is a flex column that scrolls. A flex column shrinks its
 * items to fit before it will overflow, so without an explicit
 * `flex-shrink: 0` on its children the container ends up with nothing to
 * scroll while the items that did not fit are clipped out of reach — which is
 * how Account and Sign out went missing on a phone. Both are also what the
 * app stores require to be reachable, so this is pinned rather than eyeballed.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
const fixtureFile = ".mobile-qa/fixtures.json";

test("the More menu scrolls to Account and Sign out", async ({ page, context }, info) => {
  test.skip(!fs.existsSync(fixtureFile), "Generate local mobile fixtures first.");
  const [, width, locale, theme] = info.project.name.split("-");
  test.skip(Number(width) > 900, "The More menu is the phone and tablet layout only.");

  const fixtures = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
  const user = fixtures.users.admin;
  const localURL = info.project.use.baseURL ?? "http://127.0.0.1:3100";

  const value = await encode({
    secret: process.env.NEXTAUTH_SECRET!,
    token: { sub: user.id, ...user, status: "active", accessRoleId: null, locale, expiresAt: Date.now() + 3600000, refreshedAt: Date.now() },
  });
  await context.addCookies([
    { name: "podium_locale", value: locale, url: localURL },
    { name: "podium_theme", value: theme, url: localURL },
    { name: "next-auth.session-token", value, url: localURL },
  ]);

  expect((await page.goto("/"))?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("data-mobile-ready", "true");
  // The dev server's overlay badge sits bottom-left, which is exactly where
  // the More tab lands in Arabic. It is not part of the app.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });

  // Open it the way a thumb does, from the tab bar.
  await page.locator(".mobile-tabbar button", { hasText: /More|المزيد/ }).click();
  const nav = page.locator("#console-nav[data-open]");
  await expect(nav).toBeVisible();

  // The container must actually be scrollable: content taller than the box.
  // If the children were being shrunk instead, these would be equal and the
  // overflow would be clipped away with no way to reach it.
  const box = await nav.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(box.scroll).toBeGreaterThan(box.client);

  // And the two that have to be reachable, are.
  const account = nav.locator(".console-utilities a[href='/account']");
  const signOut = nav.locator(".console-utilities").getByRole("button", { name: /Sign out|تسجيل الخروج/ });
  for (const target of [account, signOut]) {
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeInViewport();
  }

  // Tapping Account leaves the menu and lands on the account screen, where
  // deleting the account lives.
  await account.click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("button", { name: /Delete account|حذف الحساب/ })).toBeVisible();
});
