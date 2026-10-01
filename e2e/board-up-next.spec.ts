/**
 * THE LIVE BOARD'S "UP NEXT" — only the next wave's teams, in a real browser.
 *
 * A training competition of 46 paid teams: 7 placed in wave 1, the other 39
 * not placed yet (still carrying the bare wave number 1 an import leaves).
 * "Up next — Wave 1" must hold exactly those 7 rows — no other team in its
 * DOM, no "of 46". An empty next wave is an empty panel; no wave left is
 * "No upcoming waves".
 */
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { createTranslator } from "../src/lib/i18n/dictionary";

loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Board fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

test("Up next shows exactly the next wave's teams", async ({ page, context }, info) => {
  test.setTimeout(240_000);
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const id = `upn-qa-${randomUUID().slice(0, 8)}`;
  const origin = info.project.use.baseURL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Local fixture sessions only");
  const hq = await db.user.create({ data: { id: `${id}-hq`, name: "Upn hq", email: `${id}-hq@upn-qa.invalid`, role: "admin", status: "active", approvalStatus: "approved" } });

  await db.series.create({ data: {
    id, slug: id, name: `Upn QA ${id.slice(-8)}`, status: "live", isTraining: true, competitionDate: new Date(),
    zones: { create: [1, 2].map((number) => ({ number, name: `Zone ${number}` })) },
    waves: { create: [
      { id: `${id}-w1`, number: 1, startTime: "09:00", capacity: 7, durationMinutes: 11 },
      { id: `${id}-w2`, number: 2, startTime: "09:20", capacity: 7, durationMinutes: 11 },
    ] },
  } });
  const placed = [1, 2, 3, 4, 5, 6, 7];
  for (let number = 1; number <= 46; number++) {
    const inWave = placed.includes(number);
    await db.team.create({ data: {
      id: `${id}-t${number}`, seriesId: id, number, name: `UPN ${number}`, category: "Mens", division: "Rookie", paymentStatus: "paid",
      wave: 1, waveId: inWave ? `${id}-w1` : null, station: inWave ? number : null,
      competitors: { create: [1, 2].map((position) => ({ position, fullName: `Upn ${number}-${position}`, normalizedName: `upn ${number} ${position}` })) },
    } });
  }

  await context.addCookies([
    { name: "podium_locale", value: locale, url: origin },
    { name: "next-auth.session-token", url: origin, value: await encode({ secret: process.env.NEXTAUTH_SECRET!,
      token: { sub: hq.id, id: hq.id, email: hq.email, name: hq.name, role: "admin", studioId: null, status: "active", locale, expiresAt: Date.now() + 3_600_000, refreshedAt: Date.now() } }) },
  ]);
  await mkdir(".mobile-qa/board", { recursive: true });
  const panel = page.locator(".floor-panel:visible");
  const rows = panel.locator('[data-testid="floor-row"]');
  const board = async (query = "") => {
    await page.goto(`/series/${id}/board${query}`);
    await page.waitForLoadState("networkidle");
  };

  try {
    await board();
    await expect(panel).toContainText(t("Up next"));
    await expect(rows).toHaveCount(7);
    expect((await rows.evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-team"))))).sort((a, b) => a - b)).toEqual(placed);
    await expect(panel.getByTestId("floor-count")).toHaveText(t("{count} teams in this wave", { count: 7 }));
    await expect(panel).not.toContainText("46");
    // Not one of the 39 unplaced teams is anywhere in the panel's DOM, hidden or not.
    expect(await panel.evaluate((el) => el.innerHTML.includes("UPN 8"))).toBe(false);
    await page.screenshot({ path: `.mobile-qa/board/${info.project.name}-up-next.png`, fullPage: true });

    // Wave 1 done; wave 2 is next and empty: an empty panel, never the field.
    await db.wave.update({ where: { id: `${id}-w1` }, data: { status: "complete", startedAt: new Date(Date.now() - 20 * 60_000), endsAt: new Date(Date.now() - 5 * 60_000) } });
    await board();
    await expect(panel).toContainText(`${t("Wave")} 2`);
    await expect(rows).toHaveCount(0);
    await expect(panel.getByTestId("floor-empty")).toBeVisible();

    // No wave left to run. The wall then shows the final leaderboard (the
    // event is over); BFT MENA's preview of the running board says so plainly.
    await db.wave.update({ where: { id: `${id}-w2` }, data: { status: "complete", startedAt: new Date(Date.now() - 10 * 60_000), endsAt: new Date(Date.now() - 1 * 60_000) } });
    await board("?preview=1");
    await expect(panel).toContainText(t("No upcoming waves"));
    await expect(panel.getByTestId("floor-none")).toBeVisible();
    await expect(rows).toHaveCount(0);
  } finally {
    await db.series.delete({ where: { id } });
    await db.user.delete({ where: { id: hq.id } });
  }
});
