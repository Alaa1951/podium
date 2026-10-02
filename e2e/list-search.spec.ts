import { test, expect, type Page, type BrowserContext, type TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { visit } from "./support/visit";

loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Search fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

async function checkSearch(page: Page, context: BrowserContext, info: TestInfo, native: boolean) {
  // Keep numeric search tokens out of the shared fixture name: "Field 9"
  // must not match every team because a random suffix happens to contain 9.
  const suffix = randomUUID().slice(0, 8).replace(/\d/g, (digit) => String.fromCharCode(103 + Number(digit)));
  const id = `list-search-${suffix}`;
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const mobile = (info.project.use.viewport?.width ?? 1024) <= 900;
  const origin = info.project.use.baseURL!;
  const secureSession = process.env.MOBILE_QA_PRODUCTION === "1" && origin.startsWith("https:");
  const admin = await db.user.create({ data: {
    id: `${id}-admin`, name: `${id} Review Person`, email: `${id}-admin@search-qa.invalid`,
    role: "admin", status: "active", approvalStatus: "approved",
  } });
  try {
    await db.series.create({ data: {
      id, slug: id, name: "List search QA", status: "scheduled", isTraining: true,
      competitionDate: new Date(), waveCapacity: 3,
    } });
    const linked = await db.user.create({ data: {
      id: `${id}-athlete`, name: "Ahmed Search", email: `${id}-linked@search-qa.invalid`,
      phone: "+974 9988 7766", role: "competitor", status: "active", approvalStatus: "approved",
    } });
    for (let index = 0; index < 16; index++) {
      await db.team.create({ data: {
        seriesId: id, number: index + 1, name: index === 0 ? `${id} Waiting pair` : `${id} Field ${index}`,
        category: "Mens", division: "Open", paymentStatus: "paid",
        waitlistedAt: index === 0 ? new Date() : null,
        competitors: { create: [{
          position: 1, fullName: index === 0 ? "Ahmed Waiting" : `Field athlete ${index}`,
          normalizedName: index === 0 ? "ahmed waiting" : `field athlete ${index}`,
          email: `${id}-${index}@search-qa.invalid`, phone: index === 0 ? "+974 7746 4513" : `+974 6610 ${String(index).padStart(4, "0")}`,
          userId: index === 0 ? linked.id : null,
        }, { position: 2, fullName: `Partner ${index}`, normalizedName: `partner ${index}` }] },
      } });
    }
    await db.crmIntake.createMany({ data: [{
      seriesId: id, externalId: id, contactName: "CRM Waiting Person",
      email: `${id}-crm@search-qa.invalid`, phone: "+974 8855 6677", missing: "no category and no division",
      firstSeenAt: new Date(), lastSeenAt: new Date(),
    }, ...["A", "B"].map((suffix, index) => ({
      seriesId: id, externalId: `${id}-${suffix}`, contactName: `CRM Unrelated ${suffix}`,
      email: `${id}-crm-${suffix}@search-qa.invalid`, phone: index === 0 ? "+974 4455 6611" : "+974 5511 2233",
      missing: "no category and no division", firstSeenAt: new Date(), lastSeenAt: new Date(),
    }))] });
    await context.addCookies([
      { name: "podium_locale", value: locale, url: origin },
      { name: "podium_theme", value: info.project.name.endsWith("light") ? "light" : "dark", url: origin },
      { name: secureSession ? "__Secure-next-auth.session-token" : "next-auth.session-token", secure: secureSession, url: origin, value: await encode({ secret: process.env.NEXTAUTH_SECRET!,
        token: { sub: admin.id, id: admin.id, email: admin.email, name: admin.name, role: "admin", studioId: null,
          status: "active", locale, expiresAt: Date.now() + 3_600_000, refreshedAt: Date.now() } }) },
    ]);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await visit(page, "/users");
    if (native) await page.evaluate(() => {
      document.documentElement.dataset.native = "true";
      document.documentElement.dataset.nativePlatform = "ios";
    });
    const users = page.getByRole("searchbox");
    expect((await users.boundingBox())!.y).toBeLessThan(mobile ? 550 : 844);
    if (mobile) {
      await expect(page.locator(".list-overview-content")).toBeHidden();
      const overview = page.locator(".list-overview-toggle");
      await overview.click();
      await expect(page.locator(".list-overview-content")).toBeVisible();
      await overview.click();
      await page.getByRole("button", { name: locale === "ar" ? "الفلاتر" : "Filters", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: locale === "ar" ? "تم" : "Done", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
    } else {
      await expect(page.locator(".list-overview-content")).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Account type" })).toBeVisible();
    }
    await users.fill(`${id} Person`);
    const accountRows = mobile ? page.locator(".mobile-list-card") : page.locator(".table tbody tr:has(td:nth-child(2))");
    await expect(accountRows).toHaveCount(1);
    await expect(accountRows).toContainText(admin.email);
    if (mobile) expect((await accountRows.boundingBox())!.y).toBeLessThan(744);
    await users.fill("NobodyMatchesThisSearch");
    await expect(accountRows).toHaveCount(0);
    await page.getByRole("button", { name: locale === "ar" ? "مسح البحث" : "Clear search", exact: true }).click();
    await expect(users).toHaveValue("");

    await visit(page, `/series/${id}/registrations`);
    if (native) await page.evaluate(() => { document.documentElement.dataset.native = "true"; document.documentElement.dataset.nativePlatform = "ios"; });
    const input = page.getByRole("searchbox");
    expect((await input.boundingBox())!.y).toBeLessThan(mobile ? 550 : 844);
    if (mobile) {
      await page.evaluate(() => window.scrollTo(0, 700));
      const header = await page.locator(".console-inbox-head").boundingBox();
      expect((await input.boundingBox())!.y).toBeGreaterThanOrEqual(header ? header.y + header.height - 1 : 0);
      expect((await input.boundingBox())!.y).toBeLessThan(180);
    }
    const result = mobile ? page.locator(".mobile-list-card") : page.locator(".reg-table tbody tr:not(.reg-detail)");
    for (const query of ["7746 4513", "7746", "+97477464513", "٧٧٤٦", "Ahmed Waiting", `${id}-0@search-qa.invalid`, "99887766"]) {
      await input.fill(query);
      await expect(page.locator('.search-box[aria-busy="false"]')).toBeVisible();
      await expect(result).toHaveCount(1);
      await expect(result).toContainText("Waiting pair");
      await expect(input).toHaveValue(query);
      await expect(page.locator(".screen")).not.toContainText("CRM Unrelated");
      if (mobile) {
        await expect(result).toContainText("+974 7746 4513");
        await expect(result).toContainText(`${id}-0@search-qa.invalid`);
        await expect(result).toContainText(locale === "ar" ? "قائمة الانتظار" : "Waiting list");
        expect((await result.boundingBox())!.y).toBeLessThan(744);
      }
    }
    // An older server response must not overwrite text still being typed.
    await page.route("**/registrations?**", async (route) => {
      if (route.request().headers()["rsc"] === "1") await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
    await input.fill("774");
    await page.waitForTimeout(350);
    await input.pressSequentially("6 4513", { delay: 140 });
    await expect(input).toHaveValue("7746 4513");
    await expect(page.locator('.search-box[aria-busy="false"]')).toBeVisible();
    await expect(input).toHaveValue("7746 4513");
    await page.unroute("**/registrations?**");

    for (const query of ["8855", "8855 6677", "CRM Waiting Person", `${id}-crm@search-qa.invalid`]) {
      await input.fill(query);
      await expect(page.locator('.search-box[aria-busy="false"]')).toBeVisible();
      await expect(page.locator(".screen")).toContainText("CRM Waiting Person");
      await expect(page.locator(".screen")).toContainText("+974 8855 6677");
      await expect(page.locator(".screen")).toContainText(`${id}-crm@search-qa.invalid`);
      await expect(page.locator(".screen")).not.toContainText("CRM Unrelated");
      if (mobile) await expect(page.locator(".card.athlete-search-card")).toHaveCount(1);
      await expect(page.locator(".notice").filter({ hasText: locale === "ar" ? "لا توجد نتائج" : "Nobody matches" })).toHaveCount(0);
    }
    await input.fill("NobodyMatchesThisSearch");
    await expect(page.locator('.search-box[aria-busy="false"]')).toBeVisible();
    await expect(page.locator(".screen")).not.toContainText("CRM Waiting Person");
    await input.fill("7746");
    await expect(page.locator('.search-box[aria-busy="false"]')).toBeVisible();
    await input.press("Enter");
    await expect(input).not.toBeFocused();
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await mkdir(".mobile-qa/list-search", { recursive: true });
    await page.screenshot({ path: `.mobile-qa/list-search/${info.project.name}${native ? "-native" : ""}.png` });
    if (!native) {
      for (const screen of ["check-in", "warm-up", "results"]) {
        await visit(page, `/series/${id}/${screen}`);
        const search = page.getByRole("searchbox");
        if (mobile) expect((await search.boundingBox())!.y).toBeLessThan(650);
        await search.fill("Field 9");
        await expect(page.locator(".screen")).toContainText(`${id} Field 9`);
        await expect(page.locator(".screen")).not.toContainText(`${id} Field 7`);
        await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await db.series.deleteMany({ where: { id } });
    await db.user.deleteMany({ where: { id: { startsWith: id } } });
  }
}

test("mobile search finds users and athlete contacts including waiting registrations", async ({ page, context }, info) => {
  await checkSearch(page, context, info, false);
});
test("search fits the native iOS safe-area layout", async ({ page, context }, info) => {
  test.skip((info.project.use.viewport?.width ?? 1024) > 900, "Native layout checked at mobile widths");
  await checkSearch(page, context, info, true);
});
