import { test, expect, type BrowserContext, type TestInfo } from "@playwright/test";
import { visit } from "./support/visit";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import type { Category, Division, Role } from "../src/generated/prisma/enums";
import { createTranslator } from "../src/lib/i18n/dictionary";

loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Wave schedule fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

async function signIn(context: BrowserContext, info: TestInfo, user: { id: string; name: string | null; email: string; role: Role }, locale: "en" | "ar") {
  const origin = info.project.use.baseURL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Local fixture sessions only");
  await context.addCookies([
    { name: "podium_locale", value: locale, url: origin },
    { name: process.env.MOBILE_QA_PRODUCTION === "1" ? "__Secure-next-auth.session-token" : "next-auth.session-token",
      secure: process.env.MOBILE_QA_PRODUCTION === "1", url: origin, value: await encode({ secret: process.env.NEXTAUTH_SECRET!,
      token: { sub: user.id, ...user, studioId: null, status: "active", locale, expiresAt: Date.now() + 3600000, refreshedAt: Date.now() } }) },
  ]);
}

test("category totals, scheduling, partner request, concurrent review and rejection", async ({ page, context, browser }, info) => {
  test.setTimeout(240_000);
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const suffix = randomUUID().slice(0, 8);
  const id = `wave-qa-${suffix}`;
  const users = await Promise.all((["admin", "athlete", "partner"] as const).map(name => db.user.create({ data: {
    id: `${id}-${name}`, name: `Wave QA ${name}`, email: `${id}-${name}@wave-qa.invalid`, role: name === "admin" ? "admin" : "competitor",
    status: "active", approvalStatus: "approved", emailVerified: new Date(),
  } })));
  const [admin, athlete, partner] = users;
  const series = await db.series.create({ data: { id, slug: id, name: `Wave QA ${suffix}`, competitionDate: new Date("2027-02-01T07:00:00Z"),
    firstWaveTime: "07:00", waveIntervalMinutes: 20, waveCapacity: 7, waveMinutes: 115,
    zones: { create: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, name: `Zone ${i + 1}` })) },
  } });
  const categories: [Category, Division][] = [
    ...Array.from({ length: 6 }, () => ["Mens", "Rookie"] as [Category, Division]),
    ["Mens", "Open"], ["Mens", "Pro"], ["Mixed", "Rookie"], ["Mixed", "Rookie"],
    ["Mixed", "Open"], ["Mixed", "Open"], ["Mixed", "Pro"], ["Womens", "Rookie"], ["Womens", "Open"], ["Womens", "Pro"],
    ["Mens", "Rookie"], ["Womens", "Pro"],
  ];
  const teams: { id: string }[] = [];
  for (const [index, [category, division]] of categories.entries()) {
    const number = index + 100;
    teams.push(await db.team.create({ data: { seriesId: id, name: `QA Pair ${number}`, number, category, division,
      archivedAt: index === 17 ? new Date() : null, waitlistedAt: index === 16 ? new Date() : null,
      paymentStatus: index % 2 ? "pending" : "paid",
      competitors: { create: [1, 2].map(position => ({ position, fullName: `QA ${number} ${position}`, normalizedName: `qa ${number} ${position}`,
        userId: index === 0 ? (position === 1 ? athlete.id : partner.id) : null })) },
    } }));
  }
  const athleteContext = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const partnerContext = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const reviewerContext = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const athletePage = await athleteContext.newPage();
  const partnerPage = await partnerContext.newPage();
  const reviewerPage = await reviewerContext.newPage();
  page.on("dialog", dialog => dialog.accept());
  await mkdir(".mobile-qa/wave-schedule", { recursive: true });
  const capture = async (name: string) => {
    await expect(page.locator("body")).not.toContainText("Application error");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `.mobile-qa/wave-schedule/${info.project.name}-${name}.png`, fullPage: true });
  };
  try {
    await signIn(context, info, admin, locale);
    await signIn(athleteContext, info, athlete, locale);
    await signIn(partnerContext, info, partner, locale);
    await signIn(reviewerContext, info, admin, locale);
    await visit(page, `/series/${series.slug}`);
    await expect(page.locator(".category-stats .stat-label")).toHaveText([t("Mens"), t("Mixed"), t("Womens")]);
    await expect(page.locator(".category-stats .stat-value")).toHaveText(["8", "5", "3"]);
    await capture("overview");
    await page.locator(".category-stats-levels a").first().click();
    await expect(page).toHaveURL(/place=field&category=Mens&division=Rookie/);
    await expect(page.locator(".reg-filters-count")).toContainText("6");

    // Auto Assign places each category in its own block, so it waits for the category schedule.
    await visit(page, `/series/${series.slug}/waves`);
    await expect(page.getByTestId("schedule-missing").filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("button", { name: t("Auto-assign waves"), exact: true })).toBeDisabled();
    // Six zones of 15 minutes, 5-minute changeovers: a 115-minute wave, Zone 1 busy 20 minutes.
    // Men 8 = waves at 07:00 and 07:20, finishing 09:15; +60 → Mixed from 10:15, finishing 12:10; +60 → Women from 13:10.
    await db.categorySchedule.createMany({ data: [
      { seriesId: id, category: "Mens", position: 1, startTime: "07:00", breakMinutes: 60 },
      { seriesId: id, category: "Mixed", position: 2, startTime: "10:15", breakMinutes: 60 },
      { seriesId: id, category: "Womens", position: 3, startTime: "13:10", breakMinutes: 60 },
    ] });
    await page.reload();
    await expect(page.getByTestId("schedule-fits").filter({ visible: true })).toBeVisible();
    await page.getByRole("button", { name: t("Auto-assign waves"), exact: true }).click();
    await expect.poll(() => db.wave.count({ where: { seriesId: id } })).toBe(4);
    const waves = await db.wave.findMany({ where: { seriesId: id }, orderBy: { number: "asc" } });
    expect(waves.map(w => [w.startTime, w.capacity, w.blockCategory])).toEqual([["07:00", 7, "Mens"], ["07:20", 7, "Mens"], ["10:15", 7, "Mixed"], ["13:10", 7, "Womens"]]);
    const placed = await db.team.findMany({ where: { seriesId: id, archivedAt: null, waitlistedAt: null }, orderBy: [{ wave: "asc" }, { station: "asc" }], include: { waveRef: true } });
    // Never another category's block, however much room is left in a wave.
    expect(placed.every(team => team.category === team.waveRef?.blockCategory)).toBe(true);
    expect(placed.map(team => [team.wave, team.station])).toEqual([
      [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [2, 1], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [4, 1], [4, 2], [4, 3],
    ]);
    expect((await db.team.findMany({ where: { id: { in: teams.slice(16).map(team => team.id) } } })).every(team => team.waveId === null)).toBe(true);
    await capture("waves");

    await visit(page, `/series/${series.slug}/waves/${waves[1].id}/edit`);
    await page.locator('input[name="startTime"]:visible').fill("08:11");
    await page.getByRole("button", { name: t("Save wave"), exact: true }).click();
    await expect.poll(async () => (await db.wave.findUniqueOrThrow({ where: { id: waves[1].id } })).startTime).toBe("08:11");
    // Times come from the category schedule: Arrange time is not offered alongside it.
    await visit(page, `/series/${series.slug}/waves`);
    await expect(page.getByRole("button", { name: t("Arrange time"), exact: true })).toHaveCount(0);

    // A longer interval no longer fits Men before Mixed: shown, and Auto Assign changes nothing.
    await visit(page, `/series/${series.slug}/settings`);
    await page.getByLabel(t("Minutes between wave starts")).filter({ visible: true }).fill("25");
    await page.getByRole("button", { name: t("Save settings"), exact: true }).click();
    await expect.poll(async () => (await db.series.findUniqueOrThrow({ where: { id } })).waveIntervalMinutes).toBe(25);
    await visit(page, `/series/${series.slug}/waves`);
    await expect(page.getByTestId("schedule-conflicts").filter({ visible: true })).toBeVisible();
    await page.getByRole("button", { name: t("Auto-assign waves"), exact: true }).click();
    await expect(page.getByTestId("schedule-message").filter({ visible: true })).toContainText(t("Auto Assign did not run: the day does not fit. Nothing was changed."));
    expect((await db.wave.findUniqueOrThrow({ where: { id: waves[1].id } })).startTime).toBe("08:11");
    await visit(page, `/series/${series.slug}/settings`);
    await page.getByLabel(t("Minutes between wave starts")).filter({ visible: true }).fill("20");
    await page.getByRole("button", { name: t("Save settings"), exact: true }).click();
    await expect.poll(async () => (await db.series.findUniqueOrThrow({ where: { id } })).waveIntervalMinutes).toBe(20);

    await visit(athletePage, `/me?series=${id}`);
    await expect(athletePage.locator(".stat-note:visible")).toContainText(["", "07:00", "", ""]);
    await athletePage.locator('select[name="preference"]:visible').selectOption("midday");
    await athletePage.locator('textarea[name="note"]:visible').fill("Please move our pair later.");
    await visit(partnerPage, `/my-wave?series=${id}`);
    await partnerPage.locator('select[name="preference"]:visible').selectOption("midday");
    await Promise.all([
      athletePage.getByRole("button", { name: t("Send request"), exact: true }).click(),
      partnerPage.getByRole("button", { name: t("Send request"), exact: true }).click(),
    ]);
    await expect(athletePage.getByText(t("Your team already has a pending time change request."), { exact: true }).filter({ visible: true })).toBeVisible();
    await visit(partnerPage, `/my-wave?series=${id}`);
    await expect(partnerPage.getByText(t("Your team already has a pending time change request."), { exact: true }).filter({ visible: true })).toBeVisible();
    expect(await db.waveChangeRequest.count({ where: { teamId: teams[0].id, status: "pending" } })).toBe(1);

    const approvals = `/approvals?tab=waves&series=${id}&status=all`;
    await visit(page, approvals);
    await visit(reviewerPage, approvals);
    await page.getByLabel(t("Move to wave")).filter({ visible: true }).selectOption(waves[1].id);
    await reviewerPage.getByLabel(t("Move to wave")).filter({ visible: true }).selectOption(waves[1].id);
    await capture("approvals");
    await Promise.all([
      page.getByRole("button", { name: t("Approve & move"), exact: true }).click(),
      reviewerPage.getByRole("button", { name: t("Approve & move"), exact: true }).click(),
    ]);
    await expect.poll(() => db.waveChangeRequest.count({ where: { teamId: teams[0].id, status: "approved" } })).toBe(1);
    const moved = await db.team.findUniqueOrThrow({ where: { id: teams[0].id } });
    expect([moved.waveId, moved.wave, moved.station]).toEqual([waves[1].id, 2, 2]);
    // An approved move is a placement by hand: it runs manually.
    expect(moved.slotManualAt).not.toBeNull();
    await expect.poll(() => db.adminAuditLog.count({ where: { targetId: teams[0].id, action: "wave.change_approved" } })).toBe(1);
    await athletePage.reload(); await partnerPage.reload();
    await expect(athletePage.locator(".stat-card:visible").filter({ has: athletePage.locator(".stat-label", { hasText: t("Wave") }) })).toContainText("08:11");
    await expect(partnerPage.locator("dd:visible").filter({ hasText: "08:11" })).toBeVisible();

    await partnerPage.locator('select[name="preference"]:visible').selectOption("morning");
    await partnerPage.getByRole("button", { name: t("Send request"), exact: true }).click();
    await expect.poll(() => db.waveChangeRequest.count({ where: { teamId: teams[0].id, status: "pending" } })).toBe(1);
    await visit(page, approvals);
    await page.getByLabel(t("Rejection reason")).filter({ visible: true }).fill("Morning waves are full.");
    await page.getByRole("button", { name: t("Reject"), exact: true }).click();
    await expect.poll(() => db.waveChangeRequest.count({ where: { teamId: teams[0].id, status: "rejected" } })).toBe(1);
    await partnerPage.reload();
    await expect(partnerPage.getByText("Morning waves are full.", { exact: false }).filter({ visible: true })).toBeVisible();
    await partnerPage.screenshot({ path: `.mobile-qa/wave-schedule/${info.project.name}-athlete.png`, fullPage: true });

    // Rebuilding keeps the approved move exactly where it was, and the decision history.
    // At 900px or less the Waves list shows wave links; team rows live on the wave's own page.
    if ((page.viewportSize()?.width ?? 1024) <= 900) await visit(page, `/series/${series.slug}/waves/${waves[1].id}`);
    else await visit(page, `/series/${series.slug}/waves`);
    await expect(page.getByTestId("team-row-100").filter({ visible: true }).getByTestId("running-manually")).toBeVisible();
    await visit(page, `/series/${series.slug}/waves`);
    await page.getByRole("button", { name: t("Auto-assign waves"), exact: true }).click();
    await expect(page.getByTestId("schedule-message").filter({ visible: true })).toBeVisible();
    const kept = await db.team.findUniqueOrThrow({ where: { id: teams[0].id } });
    expect([kept.waveId, kept.station]).toEqual([waves[1].id, 2]);
    expect(await db.waveChangeRequest.count({ where: { teamId: teams[0].id } })).toBe(2);
  } finally {
    await athleteContext.close(); await partnerContext.close(); await reviewerContext.close();
    // Only this test's randomly named fixtures are removed.
    await db.series.delete({ where: { id } });
    await db.adminAuditLog.deleteMany({ where: { actorId: { in: users.map(user => user.id) } } });
    await db.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  }
});
