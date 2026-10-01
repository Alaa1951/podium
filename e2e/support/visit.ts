import type { Page, Response } from "@playwright/test";

/**
 * page.goto for a slow dev build, above all in WebKit: go, then wait until the
 * page is settled and hydrated before the test touches it.
 *
 *   * WebKit can still be finishing the PREVIOUS page when the next goto is
 *     issued — Next.js's hydration rewrites that page's address in place, and
 *     WebKit reports it as a navigation interrupting ours ("is interrupted by
 *     another navigation to <the page being left>"). Nobody leaves a page that
 *     fast by hand; the test simply asks again.
 *   * A field filled before React hydrates is reset to its server value when
 *     it does, and the form then saves the old value. The app marks
 *     `html[data-mobile-ready]` once its root has hydrated (mobile-runtime.tsx).
 *
 * Any other failure is thrown as it is.
 */
export async function visit(page: Page, url: string, attempts = 3): Promise<Response | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.waitForFunction(() => document.documentElement.dataset.mobileReady === "true", undefined, { timeout: 15_000 }).catch(() => undefined);
      return response;
    } catch (error) {
      if (attempt >= attempts || !String(error).includes("is interrupted by another navigation")) throw error;
      await page.waitForLoadState("load").catch(() => undefined);
    }
  }
}
