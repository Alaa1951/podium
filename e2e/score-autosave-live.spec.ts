import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { createTranslator } from "../src/lib/i18n/dictionary";

loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Autosave fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

test("mobile counters save every change and update another live board before submission", async ({ browser }, info) => {
  test.setTimeout(180_000);
  const id = `autosave-qa-${randomUUID().slice(0, 8)}`;
  const origin = info.project.use.baseURL!;
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const role = await db.accessRole.findUniqueOrThrow({ where: { key: "judge" } });
  const judge = await db.user.create({ data: {
    id: `${id}-judge`, name: "Autosave judge", email: `${id}-judge@autosave-qa.invalid`,
    role: "organiser", status: "active", approvalStatus: "approved",
    accessRoles: { create: { accessRoleId: role.id } },
  } });
  const admin = await db.user.create({ data: {
    id: `${id}-admin`, name: "Autosave admin", email: `${id}-admin@autosave-qa.invalid`,
    role: "admin", status: "active", approvalStatus: "approved",
  } });
  const contexts: BrowserContext[] = [];
  try {
    await db.series.create({ data: {
      id, slug: id, name: `Autosave QA ${id}`, status: "live", isTraining: true,
      competitionDate: new Date(), zoneWorkMinutes: 15, zoneBreakMinutes: 5, waveCapacity: 2,
      zones: { create: [1, 2].map((number) => ({
        id: `${id}-z${number}`, number, name: `Zone ${number}`,
        inputs: { create: [
          { id: `${id}-reps${number}`, position: 1, label: "Reps", unit: "reps", multiplyBy: 10 },
          { id: `${id}-metres${number}`, position: 2, label: "Metres", unit: "m", divideBy: 100 },
        ] },
      })) },
      waves: { create: {
        id: `${id}-w1`, number: 1, startTime: "09:00", capacity: 2, durationMinutes: 35,
        status: "running", startedAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 34 * 60_000),
      } },
    } });
    for (const number of [1, 2]) {
      await db.team.create({ data: {
        id: `${id}-t${number}`, seriesId: id, number, name: `AUTOSAVE TEAM ${number}`,
        category: "Mens", division: "Open", paymentStatus: "paid", wave: 1, waveId: `${id}-w1`, station: number,
        competitors: { create: [1, 2].map((position) => ({ position, fullName: `Autosave ${number}-${position}`, normalizedName: `autosave ${number} ${position}` })) },
      } });
    }
    await db.zoneStaff.create({ data: { seriesId: id, zoneId: `${id}-z1`, userId: judge.id, position: "judge", station: 1 } });
    async function contextFor(user: typeof judge, width: number) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, baseURL: origin, ignoreHTTPSErrors: true });
      contexts.push(context);
      await context.addCookies([
        { name: "podium_locale", value: locale, url: origin },
        { name: process.env.MOBILE_QA_PRODUCTION === "1" ? "__Secure-next-auth.session-token" : "next-auth.session-token", secure: process.env.MOBILE_QA_PRODUCTION === "1", url: origin, value: await encode({ secret: process.env.NEXTAUTH_SECRET!, token: {
          sub: user.id, id: user.id, email: user.email, name: user.name, role: user.role, studioId: null,
          status: "active", locale, expiresAt: Date.now() + 3_600_000, refreshedAt: Date.now(),
        } }) },
      ]);
      return context;
    }
    const wall = await (await contextFor(admin, 1920)).newPage();
    const live = wall.waitForResponse((response) => response.url().endsWith(`/api/series/${id}/events`) && response.status() === 200);
    await wall.goto(`/series/${id}/board`);
    await live;
    await expect(wall.locator('[data-testid="running-board"]:visible')).toHaveCount(1);
    const publicContext = await browser.newContext({ viewport: { width: 1920, height: 900 }, baseURL: origin, ignoreHTTPSErrors: true });
    contexts.push(publicContext);
    const publicWall = await publicContext.newPage();
    const publicLive = publicWall.waitForResponse((response) => response.url().endsWith(`/api/live/${id}/events`) && response.status() === 200);
    await publicWall.goto(`/live/${id}`);
    await publicLive;
    await expect(publicWall.locator('[data-testid="running-board"]:visible')).toHaveCount(1);
    const phone = await (await contextFor(judge, 390)).newPage();
    await phone.goto(`/my-wave?series=${id}`);
    await expect(phone.locator("html")).toHaveAttribute("data-mobile-ready", "true");
    const card = phone.locator(".zone-entry:visible").filter({ hasText: "AUTOSAVE TEAM 1" });
    const plus = card.getByRole("button", { name: `${t("Reps")} +1`, exact: true });
    await expect(plus).toBeEnabled();
    await expect(card.getByRole("button", { name: t("Save"), exact: true })).toHaveCount(0);
    for (let i = 0; i < 6; i++) await plus.click();
    await expect(card.locator(".team-entry-count-value")).toHaveText("6");
    const value = async (teamNumber: number, input: string) => (await db.zoneEntry.findFirst({
      where: { score: { teamId: `${id}-t${teamNumber}` }, inputId: `${id}-${input}` },
    }))?.value;
    await expect.poll(() => value(1, "reps1")).toBe(6);
    const row = wall.locator(".zone-row:visible").filter({ hasText: "AUTOSAVE TEAM 1" });
    await expect(row.locator(".display.num")).toHaveText("60.00", { timeout: 3_000 });
    const publicRow = publicWall.locator(".zone-row:visible").filter({ hasText: "AUTOSAVE TEAM 1" });
    await expect(publicRow.locator(".display.num")).toHaveText("60.00", { timeout: 3_000 });
    expect(await db.zoneScore.count({ where: { score: { teamId: `${id}-t1` }, status: "submitted" } })).toBe(0);
    await card.getByRole("button", { name: `${t("Reps")} −1`, exact: true }).click();
    await expect.poll(() => value(1, "reps1")).toBe(5);
    await card.getByRole("spinbutton", { name: t("Metres"), exact: true }).fill("250");
    await expect.poll(() => value(1, "metres1")).toBe(250);
    await expect(row.locator(".display.num")).toHaveText("52.50", { timeout: 3_000 });
    await expect(publicRow.locator(".display.num")).toHaveText("52.50", { timeout: 3_000 });
    await phone.reload();
    await expect(phone.locator("html")).toHaveAttribute("data-mobile-ready", "true");
    await expect(card.locator(".team-entry-count-value")).toHaveText("5");

    // Final submission waits for a last autosave, then locks the zone.
    await card.getByRole("spinbutton", { name: t("Metres"), exact: true }).fill("300");
    phone.once("dialog", (dialog) => { void dialog.accept(); });
    await card.getByRole("button", { name: t("Submit zone"), exact: true }).click();
    await expect(card.locator(".badge")).toHaveText(t("Submitted"));
    await expect(plus).toBeDisabled();
    await expect.poll(() => value(1, "metres1")).toBe(300);
    expect(await db.zoneScore.count({ where: { score: { teamId: `${id}-t1` }, status: "submitted" } })).toBe(1);
    await expect(row.locator(".display.num")).toHaveText("53.00", { timeout: 3_000 });

    // Another authorised operator uses the same automatic writes on the mobile console.
    const consolePhone = await (await contextFor(admin, 390)).newPage();
    await consolePhone.goto(`/series/${id}/scores/${id}-t2`);
    await expect(consolePhone.locator("html")).toHaveAttribute("data-mobile-ready", "true");
    const entry = consolePhone.locator(".team-entry");
    await expect(entry.getByRole("button", { name: t("Save"), exact: true })).toHaveCount(0);
    const consolePlus = entry.getByRole("button", { name: `${t("Reps")} +1`, exact: true }).first();
    for (let i = 0; i < 4; i++) await consolePlus.click();
    await expect.poll(() => value(2, "reps1")).toBe(4);
    const secondRow = wall.locator(".zone-row:visible").filter({ hasText: "AUTOSAVE TEAM 2" });
    await expect(secondRow.locator(".display.num")).toHaveText("40.00", { timeout: 3_000 });
    expect(await db.zoneScore.count({ where: { score: { teamId: `${id}-t2` }, status: "submitted" } })).toBe(0);
    await entry.getByRole("button", { name: t("Back to the list"), exact: false }).click();
    await expect(consolePhone).not.toHaveURL(new RegExp(`${id}-t2$`));
    expect(await value(2, "reps1")).toBe(4);
  } finally {
    for (const context of contexts) await context.close();
    await db.series.deleteMany({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: [judge.id, admin.id] } } });
  }
});
