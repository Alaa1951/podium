import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

for (const role of ["admin", "studio"]) {
  test(`${role} bottom tabs preload actual data and expire it`, async ({ page, context }, info) => {
    test.skip(process.env.MOBILE_QA_PRODUCTION !== "1" || info.project.use.viewport!.width > 900,
      "Data prefetch is a production mobile behavior.");
    const fixtures = JSON.parse(fs.readFileSync(".mobile-qa/fixtures.json", "utf8"));
    const user = fixtures.users[role];
    const origin = info.project.use.baseURL!;
    const base = `/${role === "admin" ? "series" : "studio"}/mobile-qa-live`;
    const waves = `${base}/waves`;
    const list = `${base}/${role === "admin" ? "registrations" : "teams"}`;
    await context.addCookies([{ name: "__Secure-next-auth.session-token", url: origin, secure: true,
      value: await encode({ secret: process.env.NEXTAUTH_SECRET!, token: { sub: user.id, ...user, status: "active", accessRoleId: null,
        locale: "en", expiresAt: Date.now() + 3600000, refreshedAt: Date.now() } }) }]);

    let warmed = false;
    page.on("response", async response => {
      // Full dynamic prefetches omit the partial-prefetch header in Next 16.
      if (new URL(response.url()).pathname !== waves || response.request().resourceType() !== "fetch") return;
      try { if ((await response.text()).includes("mobile-e2e-live-wave")) warmed = true; } catch { /* Cancelled speculative fetch. */ }
    });
    await page.goto(list);
    await expect(page.locator("html")).toHaveAttribute("data-mobile-ready", "true");
    // The actual wave ID proves the data arrived, not just a loading skeleton.
    await expect.poll(() => warmed).toBe(true);
    const dataRequests: string[] = [];
    let opening = true;
    await page.route("**/*_rsc=*", async route => {
      if (new URL(route.request().url()).pathname === waves) {
        if (!opening) { await route.abort(); return; }
        dataRequests.push(route.request().url());
        await new Promise(resolve => setTimeout(resolve, 1800));
      }
      await route.continue();
    });
    await page.locator(`.mobile-tabbar:visible a[href="${waves}"]`).click();
    await expect(page.locator(`.mobile-list-card:visible[href="${waves}/mobile-e2e-live-wave"]`)).toBeVisible({ timeout: 1000 });
    expect(dataRequests).toHaveLength(0);

    opening = false;
    await page.locator(`.mobile-tabbar:visible a[href="${list}"]`).click();
    await expect(page).toHaveURL(list);
    // No automatic rewarming is allowed above. After the bounded 30s lifetime,
    // opening this tab must obtain fresh server data instead of a stale snapshot.
    await page.waitForTimeout(31000);
    opening = true;
    await page.locator(`.mobile-tabbar:visible a[href="${waves}"]`).click();
    await expect.poll(() => dataRequests.length).toBeGreaterThan(0);
    await expect(page.locator(`.mobile-list-card:visible[href="${waves}/mobile-e2e-live-wave"]`)).toBeVisible();
  });
}
