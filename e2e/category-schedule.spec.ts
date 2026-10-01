/**
 * THE CATEGORY SCHEDULE AND MANUAL PLACEMENT, walked in a real browser.
 *
 *   BFT MENA   sets each category's start and break in Settings and sees the
 *              day previewed as it types — a conflict first, then a fit;
 *              runs Auto Assign; moves a Women team into a Mixed slot
 *              (confirming the exception) and a Men team after its awards
 *              (confirming the warning); re-runs Auto Assign; returns a team
 *              to Auto Assign.
 *   A VOLUNTEER sees the running order and the warm-up exception, but no
 *              schedule or placement buttons.
 *   A JUDGE    never reaches the Waves screen or the settings: their own
 *              judge sheet is all the Judge role opens.
 *
 * Every step presses what a person presses, then reads the database.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { visit } from "./support/visit";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import type { Category, Division, Role } from "../src/generated/prisma/enums";
import { createTranslator } from "../src/lib/i18n/dictionary";
import { systemRole } from "../src/lib/permissions/system-roles";

loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Schedule fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

type Person = { id: string; name: string; email: string; role: Role; studioId: string | null };

test("category schedule, Auto Assign by category, and moving a team by hand", async ({ browser }, info) => {
  test.setTimeout(420_000);
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const id = `sched-qa-${randomUUID().slice(0, 8)}`;

  const roles: Record<string, string> = {};
  for (const key of ["volunteer", "judge"]) {
    const def = systemRole(key)!;
    roles[key] = (await db.accessRole.create({ data: { key: `${id}-${key}`, name: `${def.name} ${id}`, permissions: def.permissions } })).id;
  }
  const person = async (key: string, role: Role, roleKey?: string): Promise<Person> => {
    const user = await db.user.create({ data: {
      id: `${id}-${key}`, name: `Sched ${key}`, email: `${id}-${key}@sched-qa.invalid`, role, status: "active", approvalStatus: "approved",
      ...(roleKey ? { accessRoles: { create: { accessRoleId: roles[roleKey] } } } : {}),
    } });
    return { id: user.id, name: user.name!, email: user.email, role, studioId: null };
  };
  const hq = await person("hq", "admin");
  const volunteer = await person("vol", "organiser", "volunteer");
  const judge = await person("judge", "organiser", "judge");
  const people = [hq, volunteer, judge];

  // Four zones of 15 + 5: a 75-minute wave, Zone 1 busy 20 minutes; 7 per wave.
  await db.series.create({ data: {
    id, slug: id, name: `Sched QA ${id.slice(-8)}`, status: "scheduled", competitionDate: new Date(Date.now() + 10 * 86_400_000),
    waveIntervalMinutes: 20, zoneWorkMinutes: 15, zoneBreakMinutes: 5, waveCapacity: 7, waveMinutes: 75,
    zones: { create: [1, 2, 3, 4].map((number) => ({ number, name: `Zone ${number}` })) },
  } });
  const field: [number, Category, Division][] = [
    ...[1, 2, 3, 4, 5, 6].map((n) => [n, "Mens", "Rookie"] as [number, Category, Division]), [7, "Mens", "Open"], [8, "Mens", "Pro"],
    ...[11, 12, 13, 14, 15].map((n) => [n, "Mixed", "Open"] as [number, Category, Division]),
    ...[21, 22, 23].map((n) => [n, "Womens", "Rookie"] as [number, Category, Division]),
  ];
  for (const [number, category, division] of field) {
    await db.team.create({ data: {
      id: `${id}-t${number}`, seriesId: id, number, name: `SCHED ${number}`, category, division,
      competitors: { create: [1, 2].map((position) => ({ position, fullName: `Sched ${number}-${position}`, normalizedName: `sched ${number} ${position}` })) },
    } });
  }
  const row = (number: number) => db.team.findUniqueOrThrow({ where: { id: `${id}-t${number}` }, include: { waveRef: true } });

  const origin = info.project.use.baseURL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Local fixture sessions only");
  const contexts: Awaited<ReturnType<Browser["newContext"]>>[] = [];
  const as = async (user: Person): Promise<Page> => {
    const context = await browser.newContext({ ...info.project.use, baseURL: origin });
    contexts.push(context);
    await context.addCookies([
      { name: "podium_locale", value: locale, url: origin },
      { name: "next-auth.session-token", url: origin, value: await encode({ secret: process.env.NEXTAUTH_SECRET!,
        token: { sub: user.id, ...user, status: "active", locale, expiresAt: Date.now() + 3_600_000, refreshedAt: Date.now() } }) },
    ]);
    const page = await context.newPage();
    page.on("dialog", (dialog) => dialog.accept());
    return page;
  };
  await mkdir(".mobile-qa/schedule", { recursive: true });
  const capture = async (page: Page, name: string) => {
    await expect(page.locator("body")).not.toContainText("Application error");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name}: no sideways scroll`).toBe(true);
    await page.screenshot({ path: `.mobile-qa/schedule/${info.project.name}-${name}.png`, fullPage: true });
  };
  const seen = (page: Page, selector: string) => page.locator(`${selector}:visible`);
  const button = (scope: ReturnType<Page["locator"]>, name: string) => scope.getByRole("button", { name: t(name), exact: true });
  const scheduleRow = (page: Page, category: Category) => seen(page, `[data-testid="schedule-row-${category}"]`);
  const setBlock = async (page: Page, category: Category, start: string, breakMinutes: string) => {
    await scheduleRow(page, category).locator('input[type="time"]').fill(start);
    await scheduleRow(page, category).locator('input[type="number"]').fill(breakMinutes);
  };
  const teamRow = (page: Page, number: number) => seen(page, `[data-testid="team-row-${number}"]`);
  // Pressed before the page is live, a panel opened during hydration is re-rendered empty.
  const open = async (page: Page, path?: string) => {
    if (path) await visit(page, path); else await page.reload();
    await page.waitForLoadState("networkidle");
  };
  // On a phone or tablet the running order lists its waves; a team's row is on its wave's own page.
  const phone = (info.project.use.viewport?.width ?? 1024) <= 900;
  const waves = (page: Page) => open(page, `/series/${id}/waves`);
  const showTeam = async (page: Page, number: number) => {
    const { waveId } = await row(number);
    await open(page, phone && waveId ? `/series/${id}/waves/${waveId}` : `/series/${id}/waves`);
  };

  try {
    // ── Settings → Category schedule ────────────────────────────────────────
    const office = await as(hq);
    await open(office, `/series/${id}/settings`);
    await expect(seen(office, '[data-testid="schedule-incomplete"]')).toBeVisible();
    // Nothing invented: the times start empty.
    await expect(scheduleRow(office, "Mens").locator('input[type="time"]')).toHaveValue("");
    await setBlock(office, "Mens", "09:00", "60");
    await setBlock(office, "Mixed", "11:00", "60");
    await setBlock(office, "Womens", "14:00", "90");
    // Men finish 10:35; with a 60-minute break Mixed cannot start before 11:35.
    await expect(seen(office, '[data-testid="schedule-conflicts"]')).toContainText("11:35");
    await capture(office, "settings-conflict");
    await setBlock(office, "Mixed", "11:35", "60");
    await expect(seen(office, '[data-testid="schedule-fits"]')).toBeVisible();
    await expect(seen(office, '[data-testid="block-Mens"]')).toContainText("10:35");
    await button(seen(office, '[data-testid="category-schedule"]'), "Save category schedule").click();
    await expect.poll(() => db.categorySchedule.count({ where: { seriesId: id } })).toBe(3);
    expect(await db.categorySchedule.findUniqueOrThrow({ where: { seriesId_category: { seriesId: id, category: "Mixed" } } })).toMatchObject({ startTime: "11:35", breakMinutes: 60, position: 2 });
    await capture(office, "settings");

    // ── Auto Assign by category ─────────────────────────────────────────────
    await waves(office);
    await expect(seen(office, '[data-testid="auto-assign-preview"]')).toBeVisible();
    await button(office.locator("body"), "Auto-assign waves").click();
    await expect.poll(() => db.wave.count({ where: { seriesId: id } })).toBe(4);
    expect((await db.wave.findMany({ where: { seriesId: id }, orderBy: { number: "asc" } })).map((w) => [w.startTime, w.blockCategory])).toEqual([
      ["09:00", "Mens"], ["09:20", "Mens"], ["11:35", "Mixed"], ["14:00", "Womens"],
    ]);

    // ── Scenario 6: a Women team into a free Mixed slot, confirmed as an exception ─
    await showTeam(office, 21);
    await button(teamRow(office, 21), "Move…").click();
    const panel = seen(office, '[data-testid="move-panel"]');
    const mixedWave = await db.wave.findFirstOrThrow({ where: { seriesId: id, blockCategory: "Mixed" } });
    await panel.getByLabel(t("To wave"), { exact: true }).selectOption(mixedWave.id);
    await expect(button(panel, "Confirm move")).toBeDisabled();
    await panel.getByTestId("confirm-exception").locator("input").check();
    // The panel alone: a full-page capture re-lays the page out and re-opens the panel empty.
    await panel.screenshot({ path: `.mobile-qa/schedule/${info.project.name}-move-panel.png` });
    await expect(panel.getByTestId("confirm-exception").locator("input")).toBeChecked();
    await button(panel, "Confirm move").click();
    await expect.poll(async () => (await row(21)).waveId).toBe(mixedWave.id);
    // Scenarios 7 and 8: still Women, Running Manually, shown as an exception.
    expect(await row(21)).toMatchObject({ category: "Womens", division: "Rookie", station: 6, slotManualAt: expect.any(Date) });
    if (phone) await showTeam(office, 21);
    await expect(teamRow(office, 21).getByTestId("running-manually")).toHaveText(t("Running Manually"));
    await expect(teamRow(office, 21).getByTestId("outside-block")).toBeVisible();

    // ── Scenario 16: a Men team after its awards — warned before confirming ─
    await showTeam(office, 8);
    await button(teamRow(office, 8), "Move…").click();
    const womenWave = await db.wave.findFirstOrThrow({ where: { seriesId: id, blockCategory: "Womens" } });
    await seen(office, '[data-testid="move-panel"]').getByLabel(t("To wave"), { exact: true }).selectOption(womenWave.id);
    await seen(office, '[data-testid="move-panel"]').getByTestId("confirm-exception").locator("input").check();
    await expect(seen(office, '[data-testid="move-panel"]').getByTestId("confirm-awards")).toContainText("10:35");
    await expect(button(seen(office, '[data-testid="move-panel"]'), "Confirm move")).toBeDisabled();
    await seen(office, '[data-testid="move-panel"]').getByTestId("confirm-awards").locator("input").check();
    await button(seen(office, '[data-testid="move-panel"]'), "Confirm move").click();
    await expect.poll(async () => (await row(8)).waveId).toBe(womenWave.id);
    if (phone) await showTeam(office, 8);
    await expect(teamRow(office, 8).getByTestId("late-for-awards")).toBeVisible();
    await capture(office, "waves-manual");

    // ── Scenario 9: Auto Assign again — both stay exactly where they were ───
    const before = [await row(21), await row(8)].map((one) => [one.waveId, one.station, one.waveRef?.startTime]);
    if (phone) await waves(office);
    await button(office.locator("body"), "Auto-assign waves").click();
    await expect(seen(office, '[data-testid="schedule-message"]')).toBeVisible();
    expect([await row(21), await row(8)].map((one) => [one.waveId, one.station, one.waveRef?.startTime])).toEqual(before);
    // Men now fit one wave; the Mixed wave still holds Women #21 on station 6.
    expect((await db.team.findMany({ where: { waveId: mixedWave.id }, orderBy: { station: "asc" } })).map((one) => [one.number, one.station]))
      .toEqual([[11, 1], [12, 2], [13, 3], [14, 4], [15, 5], [21, 6]]);

    // ── Scenario 10: Return to Auto Assign, confirmed ──────────────────────
    await showTeam(office, 21);
    await button(teamRow(office, 21), "Return to Auto Assign").click();
    await button(seen(office, '[data-testid="release-panel"]'), "Return to Auto Assign").click();
    await expect.poll(async () => (await row(21)).slotManualAt).toBeNull();
    expect((await row(21)).waveId).toBe(mixedWave.id);
    if (phone) await waves(office);
    await button(office.locator("body"), "Auto-assign waves").click();
    await expect.poll(async () => (await row(21)).waveRef?.blockCategory).toBe("Womens");

    // ── Into a FULL wave by exchange: #8 takes #3's station; #3 takes #8's slot ─
    const menWave = await db.wave.findFirstOrThrow({ where: { seriesId: id, blockCategory: "Mens" } });
    expect(await db.team.count({ where: { waveId: menWave.id } })).toBe(menWave.capacity);
    const eightBefore = await row(8);
    await showTeam(office, 8);
    await button(teamRow(office, 8), "Move…").click();
    const exchange = seen(office, '[data-testid="move-panel"]');
    await exchange.getByLabel(t("To wave"), { exact: true }).selectOption(menWave.id);
    // Nothing is free: the panel says what to do instead of a dead button.
    await expect(exchange.getByTestId("move-blocker")).toHaveText(t("Wave {wave} is full: choose one of its stations to exchange places with the team on it.", { wave: menWave.number }));
    await expect(button(exchange, "Confirm move")).toBeDisabled();
    await exchange.getByLabel(t("Station"), { exact: true }).selectOption("3");
    // #3 (Men) would run in the Women block, after the Men awards begin: its own two ticks.
    await exchange.getByTestId("confirm-swap-exception").locator("input").check();
    await expect(exchange.getByTestId("move-blocker")).toHaveText(t("Tick the awards warning for #{number} to confirm.", { number: 3 }));
    await exchange.getByTestId("confirm-swap-awards").locator("input").check();
    await exchange.screenshot({ path: `.mobile-qa/schedule/${info.project.name}-exchange-panel.png` });
    await button(exchange, "Confirm move").click();
    await expect.poll(async () => (await row(8)).waveId).toBe(menWave.id);
    expect(await row(8)).toMatchObject({ station: 3, slotManualAt: expect.any(Date), category: "Mens" });
    expect(await row(3)).toMatchObject({ waveId: eightBefore.waveId, station: eightBefore.station, slotManualAt: expect.any(Date), category: "Mens" });
    // On the board at once — no reload — and still after one.
    await expect(teamRow(office, 3).getByTestId("running-manually")).toBeVisible();
    await expect(teamRow(office, 3).getByTestId("late-for-awards")).toBeVisible();
    await open(office);
    await expect(teamRow(office, 3).getByTestId("outside-block")).toBeVisible();
    await showTeam(office, 8);
    await expect(teamRow(office, 8).getByTestId("running-manually")).toBeVisible();
    await expect(teamRow(office, 8).getByTestId("outside-block")).toHaveCount(0);

    // ── A team with a submitted zone says why it stays, instead of a Move button ─
    const zone = await db.zone.findFirstOrThrow({ where: { seriesId: id } });
    const score = await db.score.create({ data: { teamId: `${id}-t5` } });
    await db.zoneScore.create({ data: { scoreId: score.id, zoneId: zone.id, status: "submitted" } });
    await showTeam(office, 5);
    await expect(teamRow(office, 5).getByTestId("move-locked")).toHaveText(t("A zone of this team's score is submitted: its slot is final."));
    await expect(button(teamRow(office, 5), "Move…")).toHaveCount(0);
    await capture(office, "waves-exchanged");

    // ── The warm-up checklist shows the remaining exception ─────────────────
    await open(office, `/series/${id}/warm-up`);
    await expect(seen(office, '[data-testid="warmup-outside-block"]')).toHaveCount(1);

    // ── Scenario 14: a volunteer sees the waves but cannot build or place; a judge reaches neither waves nor settings ─
    const desk = await as(volunteer);
    await showTeam(desk, 8);
    await expect(teamRow(desk, 8)).toBeVisible();
    await expect(desk.getByRole("button", { name: t("Move…"), exact: true })).toHaveCount(0);
    await expect(desk.getByRole("button", { name: t("Auto-assign waves"), exact: true })).toHaveCount(0);
    await capture(desk, "waves-volunteer");
    // The Judge role works its own sheet only: the Waves list (every team) is not theirs.
    const referee = await as(judge);
    await visit(referee, `/series/${id}/waves`);
    await expect(referee).not.toHaveURL(new RegExp("/waves$"));
    await expect(referee.getByRole("button", { name: t("Auto-assign waves"), exact: true })).toHaveCount(0);
    await expect(referee.getByRole("button", { name: t("Move…"), exact: true })).toHaveCount(0);
    await visit(referee, `/series/${id}/settings`);
    await expect(referee).not.toHaveURL(new RegExp("/settings$"));
    expect(await db.adminAuditLog.count({ where: { actorId: { in: [volunteer.id, judge.id] } } })).toBe(0);
    expect((await db.adminAuditLog.findMany({ where: { actorId: hq.id }, select: { action: true } })).map((line) => line.action).sort()).toEqual([
      "event.category_schedule_changed", "event.waves_assigned", "event.waves_assigned", "event.waves_assigned",
      "team.slot_moved", "team.slot_moved", "team.slot_moved", "team.slot_moved", "team.slot_released",
    ]);
  } finally {
    for (const context of contexts) await context.close();
    await db.series.delete({ where: { id } });
    await db.adminAuditLog.deleteMany({ where: { actorId: { in: people.map((one) => one.id) } } });
    await db.user.deleteMany({ where: { id: { in: people.map((one) => one.id) } } });
    await db.accessRole.deleteMany({ where: { id: { in: Object.values(roles) } } });
  }
});
