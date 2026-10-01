/**
 * AUTO ASSIGN ON/OFF, walked in a real browser.
 *
 *   BFT MENA   switches Auto Assign off in Settings → Category schedule;
 *              moves the Mixed start later than a wave holding a team
 *              running manually (refused while on) and saves it; re-times
 *              that wave on the Waves screen with no confirmation; moves a
 *              Women team into the Mixed wave with no exception tick; sees
 *              no Auto-assign button but Arrange time; switches it back on.
 *   A VOLUNTEER sees the Waves screen say Auto Assign is off, with no
 *              building buttons.
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

test("Auto Assign switched off: times and moves by hand, nothing refused", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const id = `aa-qa-${randomUUID().slice(0, 8)}`;

  const volunteerRole = await db.accessRole.create({ data: { key: `${id}-volunteer`, name: `Volunteer ${id}`, permissions: systemRole("volunteer")!.permissions } });
  const person = async (key: string, role: Role, roleId?: string): Promise<Person> => {
    const user = await db.user.create({ data: {
      id: `${id}-${key}`, name: `AA ${key}`, email: `${id}-${key}@aa-qa.invalid`, role, status: "active", approvalStatus: "approved",
      ...(roleId ? { accessRoles: { create: { accessRoleId: roleId } } } : {}),
    } });
    return { id: user.id, name: user.name!, email: user.email, role, studioId: null };
  };
  const hq = await person("hq", "admin");
  const volunteer = await person("vol", "organiser", volunteerRole.id);
  const people = [hq, volunteer];

  // Four zones of 15 + 5: a 75-minute wave; 7 per wave. The day as Auto Assign left it.
  await db.series.create({ data: {
    id, slug: id, name: `AA QA ${id.slice(-8)}`, status: "scheduled", competitionDate: new Date(Date.now() + 10 * 86_400_000),
    waveIntervalMinutes: 20, zoneWorkMinutes: 15, zoneBreakMinutes: 5, waveCapacity: 7, waveMinutes: 75,
    zones: { create: [1, 2, 3, 4].map((number) => ({ number, name: `Zone ${number}` })) },
    categorySchedule: { create: [
      { category: "Mens", position: 1, startTime: "09:00", breakMinutes: 60 },
      { category: "Mixed", position: 2, startTime: "11:35", breakMinutes: 60 },
      { category: "Womens", position: 3, startTime: "14:00", breakMinutes: 90 },
    ] },
    waves: { create: [
      { id: `${id}-w1`, number: 1, startTime: "09:00", blockCategory: "Mens", capacity: 7, durationMinutes: 75 },
      { id: `${id}-w2`, number: 2, startTime: "11:35", blockCategory: "Mixed", capacity: 7, durationMinutes: 75 },
      { id: `${id}-w3`, number: 3, startTime: "14:00", blockCategory: "Womens", capacity: 7, durationMinutes: 75 },
    ] },
  } });
  const field: [number, Category, Division, string, number, boolean][] = [
    [1, "Mens", "Rookie", "w1", 1, false], [2, "Mens", "Open", "w1", 2, false],
    // #11 runs manually in the Mixed wave: while Auto Assign is on, the Mixed start cannot pass it.
    [11, "Mixed", "Open", "w2", 1, true], [12, "Mixed", "Open", "w2", 2, false],
    [21, "Womens", "Rookie", "w3", 1, false], [22, "Womens", "Rookie", "w3", 2, false],
  ];
  for (const [number, category, division, wave, station, manual] of field) {
    await db.team.create({ data: {
      id: `${id}-t${number}`, seriesId: id, number, name: `AA ${number}`, category, division, wave: Number(wave.slice(1)),
      waveId: `${id}-${wave}`, station, slotManualAt: manual ? new Date() : null,
      competitors: { create: [1, 2].map((position) => ({ position, fullName: `AA ${number}-${position}`, normalizedName: `aa ${number} ${position}` })) },
    } });
  }
  const row = (number: number) => db.team.findUniqueOrThrow({ where: { id: `${id}-t${number}` }, include: { waveRef: true } });
  const series = () => db.series.findUniqueOrThrow({ where: { id } });

  const origin = info.project.use.baseURL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Local fixture sessions only");
  const contexts: Awaited<ReturnType<Browser["newContext"]>>[] = [];
  const dialogs: string[] = [];
  const as = async (user: Person): Promise<Page> => {
    const context = await browser.newContext({ ...info.project.use, baseURL: origin });
    contexts.push(context);
    await context.addCookies([
      { name: "podium_locale", value: locale, url: origin },
      { name: "next-auth.session-token", url: origin, value: await encode({ secret: process.env.NEXTAUTH_SECRET!,
        token: { sub: user.id, ...user, status: "active", locale, expiresAt: Date.now() + 3_600_000, refreshedAt: Date.now() } }) },
    ]);
    const page = await context.newPage();
    page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.accept(); });
    return page;
  };
  await mkdir(".mobile-qa/auto-assign", { recursive: true });
  const capture = async (page: Page, name: string) => {
    await expect(page.locator("body")).not.toContainText("Application error");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name}: no sideways scroll`).toBe(true);
    await page.screenshot({ path: `.mobile-qa/auto-assign/${info.project.name}-${name}.png`, fullPage: true });
  };
  const seen = (page: Page, selector: string) => page.locator(`${selector}:visible`);
  const button = (scope: ReturnType<Page["locator"]>, name: string) => scope.getByRole("button", { name: t(name), exact: true });
  const open = async (page: Page, path?: string) => {
    if (path) await visit(page, path); else await page.reload();
    await page.waitForLoadState("networkidle");
  };
  const phone = (info.project.use.viewport?.width ?? 1024) <= 900;
  const teamRow = (page: Page, number: number) => seen(page, `[data-testid="team-row-${number}"]`);
  const showTeam = async (page: Page, number: number) => {
    const { waveId } = await row(number);
    await open(page, phone && waveId ? `/series/${id}/waves/${waveId}` : `/series/${id}/waves`);
  };
  const scheduleRow = (page: Page, category: Category) => seen(page, `[data-testid="schedule-row-${category}"]`);

  try {
    const office = await as(hq);
    await open(office, `/series/${id}/settings`);
    const toggle = seen(office, '[data-testid="auto-assign-switch"]');
    await expect(toggle.locator("input")).toBeChecked();
    await expect(toggle).toContainText(t("On: Auto Assign builds the running order by these blocks, and changes that would break a block or move a team running manually are refused or need a confirmation."));

    // ── While on: the Mixed start cannot pass the wave holding #11 ─────────
    await scheduleRow(office, "Mixed").locator('input[type="time"]').fill("12:00");
    await scheduleRow(office, "Womens").locator('input[type="time"]').fill("14:30");
    await button(seen(office, '[data-testid="category-schedule"]'), "Save category schedule").click();
    await expect(seen(office, '[data-testid="category-schedule"] [role="alert"]')).toContainText("#11");
    expect(await db.categorySchedule.findUniqueOrThrow({ where: { seriesId_category: { seriesId: id, category: "Mixed" } } })).toMatchObject({ startTime: "11:35" });

    // ── Switched off ────────────────────────────────────────────────────────
    await toggle.locator("input").uncheck();
    await expect.poll(async () => (await series()).autoAssignEnabled).toBe(false);
    await expect(toggle.locator("input")).not.toBeChecked();
    await expect(toggle).toContainText(t("Off: the running order is built by hand. Change any wave's time, category times and team slots freely — nothing is refused because of the category blocks, and nothing moves by itself."));
    // Written once the change has committed.
    await expect.poll(() => db.adminAuditLog.count({ where: { action: "event.auto_assign_changed", targetId: id, actorId: hq.id } })).toBe(1);

    // The same schedule now saves; nobody moved.
    await button(seen(office, '[data-testid="category-schedule"]'), "Save category schedule").click();
    await expect(seen(office, '[data-testid="category-schedule"] [role="status"]')).toHaveText(t("Saved. Auto Assign is off, so no wave moved: set the wave times on the Waves screen."));
    expect(await db.categorySchedule.findUniqueOrThrow({ where: { seriesId_category: { seriesId: id, category: "Mixed" } } })).toMatchObject({ startTime: "12:00" });
    expect(await row(11)).toMatchObject({ waveId: `${id}-w2`, station: 1, waveRef: { startTime: "11:35" } });
    // The preview no longer warns about #11: nothing is held up for it.
    await expect(seen(office, '[data-testid="schedule-fits"]')).toBeVisible();
    await capture(office, "settings-off");

    // ── The Waves screen: no Auto Assign, Arrange time offered ─────────────
    await open(office, `/series/${id}/waves`);
    await expect(seen(office, '[data-testid="auto-assign-off"]')).toBeVisible();
    await expect(button(office.locator("body"), "Auto-assign waves")).toHaveCount(0);
    await expect(button(office.locator("body"), "Arrange time")).toBeVisible();
    await capture(office, "waves-off");

    // ── The wave holding #11 re-timed, with no confirmation ─────────────────
    dialogs.length = 0;
    await open(office, `/series/${id}/waves/${id}-w2/edit`);
    await seen(office, `#start-${id}-w2`).fill("12:05");
    await button(office.locator("body"), "Save wave").click();
    await expect.poll(async () => (await db.wave.findUniqueOrThrow({ where: { id: `${id}-w2` } })).startTime).toBe("12:05");
    expect(dialogs).toEqual([]);
    expect(await row(11)).toMatchObject({ waveId: `${id}-w2`, station: 1 });

    // ── A Women team joins the Mixed wave: no exception tick ────────────────
    await showTeam(office, 21);
    await button(teamRow(office, 21), "Move…").click();
    const panel = seen(office, '[data-testid="move-panel"]');
    await panel.getByLabel(t("To wave"), { exact: true }).selectOption(`${id}-w2`);
    await expect(panel.getByTestId("confirm-exception")).toHaveCount(0);
    await expect(panel.getByTestId("confirm-awards")).toHaveCount(0);
    await panel.screenshot({ path: `.mobile-qa/auto-assign/${info.project.name}-move-panel.png` });
    await button(panel, "Confirm move").click();
    await expect.poll(async () => (await row(21)).waveId).toBe(`${id}-w2`);
    expect(await row(21)).toMatchObject({ category: "Womens", station: 3, slotManualAt: expect.any(Date) });
    if (phone) await showTeam(office, 21);
    await expect(teamRow(office, 21).getByTestId("outside-block")).toHaveCount(0);

    // ── A volunteer reads that it is off, and builds nothing ────────────────
    const desk = await as(volunteer);
    await open(desk, `/series/${id}/waves`);
    await expect(seen(desk, '[data-testid="auto-assign-off"]')).toBeVisible();
    await expect(desk.getByRole("button", { name: t("Arrange time"), exact: true })).toHaveCount(0);
    await expect(desk.getByRole("button", { name: t("Move…"), exact: true })).toHaveCount(0);
    await capture(desk, "waves-volunteer");

    // ── On again: Auto Assign is offered, nobody moved ──────────────────────
    const placed = await row(21);
    await open(office, `/series/${id}/settings`);
    await seen(office, '[data-testid="auto-assign-switch"]').locator("input").check();
    await expect.poll(async () => (await series()).autoAssignEnabled).toBe(true);
    await open(office, `/series/${id}/waves`);
    await expect(button(office.locator("body"), "Auto-assign waves")).toBeVisible();
    await expect(seen(office, '[data-testid="auto-assign-off"]')).toHaveCount(0);
    expect(await row(21)).toMatchObject({ waveId: placed.waveId, station: placed.station });
    await expect.poll(async () => (await db.adminAuditLog.findMany({ where: { actorId: hq.id }, select: { action: true } })).map((line) => line.action).sort()).toEqual([
      "event.auto_assign_changed", "event.auto_assign_changed", "event.category_schedule_changed", "team.slot_moved", "wave.schedule_changed",
    ]);
    expect(await db.adminAuditLog.count({ where: { actorId: volunteer.id } })).toBe(0);
  } finally {
    for (const context of contexts) await context.close();
    await db.series.delete({ where: { id } });
    await db.adminAuditLog.deleteMany({ where: { actorId: { in: people.map((one) => one.id) } } });
    await db.user.deleteMany({ where: { id: { in: people.map((one) => one.id) } } });
    await db.accessRole.deleteMany({ where: { id: volunteerRole.id } });
  }
});
