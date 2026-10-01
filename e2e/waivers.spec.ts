/**
 * WAIVER DECLARATIONS, THE DESKS, AND START WAVE — walked in a real browser.
 *
 *   BFT MENA    requires the PODIUM Series 1 waiver in Settings.
 *   ATHLETE A   is prompted, reads it in English, switches to Arabic, signs
 *               in Arabic, and reads back the receipt.
 *   VOLUNTEER   cannot check the team in while athlete B has not signed —
 *               and is told who; after B signs, checks them in, then warms
 *               the team up. A check-out takes the readiness back.
 *   BFT MENA    cannot start the wave until every athlete is signed, here and
 *               ready — the list says who is missing what — then starts it.
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
import type { Role } from "../src/generated/prisma/enums";
import { createTranslator } from "../src/lib/i18n/dictionary";
import { systemRole } from "../src/lib/permissions/system-roles";

loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Waiver fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

type Person = { id: string; name: string; email: string; role: Role; studioId: string | null };

test("an athlete signs their own waiver; the desks and Start Wave hold to it", async ({ browser }, info) => {
  test.setTimeout(420_000);
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const id = `wvr-qa-${randomUUID().slice(0, 8)}`;

  const volunteerRole = await db.accessRole.create({ data: { key: `${id}-volunteer`, name: `Volunteer ${id}`, permissions: systemRole("volunteer")!.permissions } });
  const person = async (key: string, role: Role, extra: object = {}, name = `Wvr ${key}`): Promise<Person> => {
    const user = await db.user.create({ data: { id: `${id}-${key}`, name, email: `${id}-${key}@wvr-qa.invalid`, role, status: "active", approvalStatus: "approved", ...extra } });
    return { id: user.id, name: user.name!, email: user.email, role, studioId: null };
  };
  const hq = await person("hq", "admin");
  const volunteer = await person("vol", "organiser", { accessRoles: { create: { accessRoleId: volunteerRole.id } } });
  const athleteA = await person("ath-a", "competitor", {}, "Mona Saleh");
  const athleteB = await person("ath-b", "competitor", {}, "Sara Ali");
  const people = [hq, volunteer, athleteA, athleteB];

  await db.series.create({ data: {
    id, slug: id, name: `Wvr QA ${id.slice(-8)}`, status: "live", competitionDate: new Date(), waveCapacity: 7,
    zoneWorkMinutes: 5, zoneBreakMinutes: 1, zones: { create: [1, 2].map((number) => ({ number, name: `Zone ${number}` })) },
    waves: { create: { id: `${id}-w1`, number: 1, startTime: "09:00", capacity: 7, durationMinutes: 11 } },
  } });
  await db.team.create({ data: {
    id: `${id}-t1`, seriesId: id, number: 1, name: "FALCONS", category: "Womens", division: "Rookie", paymentStatus: "paid",
    waveId: `${id}-w1`, wave: 1, station: 1,
    competitors: { create: [
      { position: 1, fullName: "Mona Saleh", normalizedName: "mona saleh", userId: athleteA.id },
      { position: 2, fullName: "Sara Ali", normalizedName: "sara ali", userId: athleteB.id },
    ] },
  } });
  const team = () => db.team.findUniqueOrThrow({ where: { id: `${id}-t1` }, include: { competitors: { orderBy: { position: "asc" } } } });

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
  const open = async (page: Page, path: string) => { await visit(page, path); await page.waitForLoadState("networkidle"); };
  await mkdir(".mobile-qa/waivers", { recursive: true });
  const capture = async (page: Page, name: string) => {
    await expect(page.locator("body")).not.toContainText("Application error");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name}: no sideways scroll`).toBe(true);
    await page.screenshot({ path: `.mobile-qa/waivers/${info.project.name}-${name}.png`, fullPage: true });
  };
  const seen = (page: Page, selector: string) => page.locator(`${selector}:visible`);
  const button = (scope: ReturnType<Page["locator"]>, name: string) => scope.getByRole("button", { name: t(name), exact: true });

  const signAs = async (page: Page, language: "en" | "ar", name: string) => {
    await open(page, `/waivers?series=${id}&lang=${language}`);
    const panel = seen(page, '[data-testid="waiver-sign"]');
    await expect(panel.getByTestId("waiver-agree")).not.toBeChecked();
    await expect(panel.getByTestId("waiver-name")).toHaveValue("");
    await expect(panel.getByTestId("waiver-submit")).toBeDisabled();
    await panel.getByTestId("waiver-agree").check();
    await panel.getByTestId("waiver-name").fill(name);
    await panel.getByTestId("waiver-submit").click();
    // Saved, then shown by the page itself — it stays, with the receipt.
    await expect(page).toHaveURL(/&signed=/, { timeout: 60_000 });
    await expect(seen(page, '[data-testid="waiver-signed"]')).toBeVisible();
    await expect(seen(page, '[data-testid="waiver-sign"]')).toHaveCount(0);
  };

  try {
    // ── BFT MENA requires the waiver ────────────────────────────────────────
    const office = await as(hq);
    await open(office, `/series/${id}/settings`);
    const settings = seen(office, '[data-testid="waiver-settings"]');
    await settings.getByTestId("attach-podium-series-1-1").click();
    await expect(settings.getByTestId("waiver-active")).toBeVisible();
    expect(await db.waiverRelease.count({ where: { seriesId: id, status: "active" } })).toBe(1);
    expect(await db.waiverAcceptance.count({ where: { seriesId: id } })).toBe(0);

    // ── Athlete A: prompted, reads, switches language, signs in Arabic ──────
    const mona = await as(athleteA);
    await open(mona, "/account");
    await expect(seen(mona, '[data-testid="waiver-prompt"]')).toBeVisible();
    await seen(mona, '[data-testid="waiver-prompt"]').getByRole("link").click();
    // A first visit compiles the page on a dev server: give navigation its time.
    await expect(mona).toHaveURL(/\/waivers\?series=/, { timeout: 120_000 });
    await mona.waitForLoadState("networkidle");
    await expect(seen(mona, '[data-testid="waiver-status"]')).toHaveAttribute("data-state", "pending");
    await open(mona, `/waivers?series=${id}&lang=en`);
    const english = seen(mona, '[data-testid="waiver-document"]');
    await expect(english).toHaveAttribute("dir", "ltr");
    await expect(english).toContainText("15. ENTIRE ACKNOWLEDGEMENT & ELECTRONIC ACCEPTANCE");
    await expect(english).toContainText("info@bftmiddleeast.com");
    await expect(english).not.toContainText("westwalk");
    await capture(mona, "waiver-en");
    await signAs(mona, "ar", "منى صالح");
    const arabic = seen(mona, '[data-testid="waiver-document"]');
    await expect(arabic).toHaveAttribute("dir", "rtl");
    await expect(arabic).toContainText("15. الإقرار الشامل والقبول الإلكتروني");
    const signed = await db.waiverAcceptance.findFirstOrThrow({ where: { seriesId: id, userId: athleteA.id } });
    expect(signed).toMatchObject({ language: "ar", typedName: "منى صالح", category: "Womens", division: "Rookie" });
    await seen(mona, '[data-testid="waiver-signed"]').getByRole("link").click();
    await expect(seen(mona, '[data-testid="receipt-signature"]')).toHaveText("منى صالح", { timeout: 120_000 });
    await expect(seen(mona, '[data-testid="receipt-intact"]')).toBeVisible();
    await capture(mona, "receipt");
    // Nobody else reads it.
    const sara = await as(athleteB);
    // (The not-found screen streams after the layout, so read the page, not the status.)
    await visit(sara, `/waivers/receipt/${signed.id}`);
    await expect(sara.locator("body")).toContainText("404");
    await expect(sara.getByTestId("waiver-receipt")).toHaveCount(0);
    await expect(sara.locator("body")).not.toContainText("منى صالح");

    // ── The entrance: B has not signed — nobody is checked in, and B is named ─
    const desk = await as(volunteer);
    await open(desk, `/series/${id}/check-in`);
    const card = seen(desk, '[data-testid="checkin-team-1"]');
    await expect(card.getByTestId("athlete-waiver").first()).toHaveAttribute("data-state", "signed");
    await expect(card.getByTestId("athlete-waiver").nth(1)).toHaveAttribute("data-state", "pending");
    await button(card, "Check in whole team").click();
    await expect(card.getByTestId("checkin-refusal")).toContainText("Sara Ali");
    await expect(card.getByTestId("checkin-refusal")).toContainText(t("Waiver acceptance required — the athlete signs on their own Waiver Declarations page"));
    await capture(desk, "entrance-refused");
    expect((await team()).competitors.every((seat) => seat.attendedAt === null)).toBe(true);

    // ── B signs on their own phone; the desk tries again ────────────────────
    await signAs(sara, "en", "Sara Ali");
    await button(card, "Check again").click();
    await expect(card.getByTestId("athlete-waiver").nth(1)).toHaveAttribute("data-state", "signed");
    await button(card, "Check in whole team").click();
    await expect.poll(async () => (await team()).attendedAt).not.toBeNull();

    // ── Start Wave: not ready in warm-up — refused, with the reason ─────────
    await open(office, `/series/${id}/wave-control`);
    await button(office.locator("body"), "Start wave").first().click();
    const blockers = seen(office, '[data-testid="start-blockers"]');
    await expect(blockers).toContainText(t("Not checked in at warm-up for this wave"));
    await capture(office, "start-blocked");
    expect((await db.wave.findUniqueOrThrow({ where: { id: `${id}-w1` } })).status).toBe("pending");

    // ── Warm-up check-in; an entrance check-out takes it back ───────────────
    await open(desk, `/series/${id}/warm-up`);
    const row = seen(desk, '[data-testid="warmup-team-1"]');
    await button(row, "Warm-up check-in").click();
    await expect.poll(async () => (await team()).warmupWaveId).toBe(`${id}-w1`);
    await open(desk, `/series/${id}/check-in`);
    await button(card.getByTestId(`checkin-athlete-${(await team()).competitors[1].id}`), "Check out").click();
    await expect.poll(async () => (await team()).warmupReadyAt).toBeNull();
    expect(await db.attendanceEvent.count({ where: { teamId: `${id}-t1`, kind: "entrance_out" } })).toBe(1);

    // ── Back in, warmed up again: the wave starts ───────────────────────────
    await button(card, "Check in whole team").click();
    await expect.poll(async () => (await team()).attendedAt).not.toBeNull();
    await open(desk, `/series/${id}/warm-up`);
    await button(row, "Warm-up check-in").click();
    await expect.poll(async () => (await team()).warmupReadyAt).not.toBeNull();
    await open(office, `/series/${id}/wave-control`);
    await button(office.locator("body"), "Start wave").first().click();
    await expect.poll(async () => (await db.wave.findUniqueOrThrow({ where: { id: `${id}-w1` } })).status).toBe("running");
  } finally {
    for (const context of contexts) await context.close();
    await db.series.delete({ where: { id } });
    await db.adminAuditLog.deleteMany({ where: { actorId: { in: people.map((one) => one.id) } } });
    await db.user.deleteMany({ where: { id: { in: people.map((one) => one.id) } } });
    await db.accessRole.delete({ where: { id: volunteerRole.id } });
  }
});
