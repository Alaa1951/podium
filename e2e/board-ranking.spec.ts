/**
 * THE LIVE BOARD RANKS A TEAM FROM ITS FIRST SAVED COUNTER — in a real browser.
 *
 * Zones are judged and submitted one by one. A running wave of four paid teams:
 * one with all four zones submitted, one with two (and a draft typed in a
 * third), one with one, and one with only a draft. The ranking must hold the
 * four teams, names and all, in order of the saved live values. Unentered zones
 * are dashes; saving counters does not submit or lock their zones.
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

// Zone → [raw value, divideBy]: 4190, 23.6, 250, 13.5 as on the reference board.
const ZONES = [[1, 1], [2, 10], [3, 1], [4, 10]] as const;

test("live counters rank teams while unentered zones remain dashes", async ({ page, context }, info) => {
  test.setTimeout(240_000);
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const id = `rank-qa-${randomUUID().slice(0, 8)}`;
  const origin = info.project.use.baseURL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Local fixture sessions only");
  const hq = await db.user.create({ data: { id: `${id}-hq`, name: "Rank hq", email: `${id}-hq@rank-qa.invalid`, role: "admin", status: "active", approvalStatus: "approved" } });

  await db.series.create({ data: {
    id, slug: id, name: `Rank QA ${id.slice(-8)}`, status: "live", isTraining: true, competitionDate: new Date(),
    zones: { create: ZONES.map(([number, divideBy]) => ({
      id: `${id}-z${number}`, number, name: `Zone ${number}`,
      inputs: { create: [{ id: `${id}-i${number}`, position: 1, label: `Movement ${number}`, divideBy }] },
    })) },
    waves: { create: [
      { id: `${id}-w1`, number: 1, startTime: "09:00", capacity: 4, durationMinutes: 60, status: "running", startedAt: new Date(Date.now() - 5 * 60_000), endsAt: new Date(Date.now() + 55 * 60_000) },
      { id: `${id}-w2`, number: 2, startTime: "10:30", capacity: 4, durationMinutes: 60 },
    ] },
  } });

  // [name, athletes, values per zone (null = none), zones submitted]
  const teams = [
    ["RAW ORDER", ["Rania Zaid", "Dana Rahman"], [4190, 236, 250, 135], [1, 2, 3, 4]],
    ["GRIT WORKS", ["Youssef Darwish", "Nabil Mansour"], [4100, 236, 7777, null], [1, 2]],
    ["APEX HOUSE", ["Bilal Khalil", "Ziad Aziz"], [3970, null, null, null], [1]],
    ["NORTH FORGE", ["Aisha Khalil", "Lina Aziz"], [9999, null, null, null], []],
  ] as const;
  for (const [index, [name, athletes, values, submitted]] of teams.entries()) {
    const number = 180 + index;
    await db.team.create({ data: {
      id: `${id}-t${number}`, seriesId: id, number, name, category: "Mens", division: "Pro", paymentStatus: "paid",
      wave: 1, waveId: `${id}-w1`, station: index + 1,
      competitors: { create: athletes.map((fullName, position) => ({ position: position + 1, fullName, normalizedName: fullName.toLowerCase() })) },
      score: { create: {
        status: submitted.length === 4 ? "submitted" : "draft",
        entries: { create: values.flatMap((value, zone) => value === null ? [] : [{ inputId: `${id}-i${zone + 1}`, value }]) },
        zones: { create: submitted.map((zone) => ({ zoneId: `${id}-z${zone}`, status: "submitted" as const, submittedAt: new Date() })) },
      } },
    } });
  }

  await context.addCookies([
    { name: "podium_locale", value: locale, url: origin },
    { name: process.env.MOBILE_QA_PRODUCTION === "1" ? "__Secure-next-auth.session-token" : "next-auth.session-token", secure: process.env.MOBILE_QA_PRODUCTION === "1", url: origin, value: await encode({ secret: process.env.NEXTAUTH_SECRET!,
      token: { sub: hq.id, id: hq.id, email: hq.email, name: hq.name, role: "admin", studioId: null, status: "active", locale, expiresAt: Date.now() + 3_600_000, refreshedAt: Date.now() } }) },
  ]);
  await mkdir(".mobile-qa/board", { recursive: true });

  try {
    await page.goto(`/series/${id}/board`);
    await expect(page.locator("html")).toHaveAttribute("data-mobile-ready", "true");
    const ranking = page.locator(".running-grid .zone-row:visible");
    await expect(ranking).toHaveCount(4);
    await expect(page.getByText(t("No scores in this bracket yet"))).toHaveCount(0);

    // Saved live values contribute even before a judge submits the zone.
    const rows = await ranking.allInnerTexts();
    expect(rows[0]).toContain("GRIT WORKS");
    expect(rows[0]).toContain("Youssef Darwish");
    expect(rows[0]).toContain("11,900.60");
    // Bracket, wave, athletes and team number under the name, as on the reference board.
    expect(rows[0]).toContain(`${t("Mens")} ${t("Pro")}`);
    expect(rows[0]).toContain(`${t("Team")} 181`);
    expect(rows[1]).toContain("NORTH FORGE");
    expect(rows[1]).toContain("Aisha Khalil");
    expect(rows[1]).toContain("9,999.00");
    expect(rows[2]).toContain("RAW ORDER");
    expect(rows[2]).toContain("Rania Zaid");
    expect(rows[2]).toContain("4,477.10");
    expect(rows[3]).toContain("APEX HOUSE");
    expect(rows[3]).toContain("Bilal Khalil");
    expect(rows[3]).toContain("3,970.00");
    // Only zones with no entered values are dashes.
    // (A phone shows no zone columns — only the total.)
    const zoneCells = (row: number) => ranking.nth(row).locator(".zone-col:visible").allInnerTexts();
    if (await ranking.first().locator(".zone-col").first().isVisible()) {
      expect(await zoneCells(0)).toEqual(["4,100", "23.60", "7,777", "—"]);
      expect(await zoneCells(1)).toEqual(["9,999", "—", "—", "—"]);
      expect(await zoneCells(2)).toEqual(["4,190", "23.60", "250", "13.50"]);
      expect(await zoneCells(3)).toEqual(["3,970", "—", "—", "—"]);
    }

    // All four teams have entered values on the live board.
    const panel = page.locator(".floor-panel:visible");
    await expect(panel.getByTestId("floor-count")).toHaveText(`4 ${t("of")} 4 ${t("scored")}`);
    await expect(panel.locator('[data-testid="floor-row"]')).toHaveCount(4);
    await expect(panel.locator('[data-testid="floor-row"][data-team="183"]')).toContainText("9,999");

    // The live payload includes draft counters, without finalizing the score.
    const html = await page.content();
    expect(html).toContain("9,999");
    expect(html).toContain("7,777");
    const payload = await (await page.request.get(`/api/series/${id}/board`)).json();
    const forge = payload.teams.find((team: { name: string }) => team.name === "NORTH FORGE");
    expect(forge).toMatchObject({ scored: true, submitted: false, total: 9999 });
    await page.screenshot({ path: `.mobile-qa/board/${info.project.name}-ranking.png` });

    // Finalizing its first zone leaves the same live value and ranking.
    const forgeScore = await db.score.findFirstOrThrow({ where: { teamId: `${id}-t183` } });
    await db.zoneScore.create({ data: { scoreId: forgeScore.id, zoneId: `${id}-z1`, status: "submitted", submittedAt: new Date() } });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-mobile-ready", "true");
    await expect(ranking).toHaveCount(4);
    expect((await ranking.nth(1).innerText())).toContain("NORTH FORGE");
    await expect(panel.getByTestId("floor-count")).toHaveText(`4 ${t("of")} 4 ${t("scored")}`);
  } finally {
    await db.series.delete({ where: { id } });
    await db.user.delete({ where: { id: hq.id } });
  }
});

test("a score unlocked for correction stays on the board, and the saved correction re-ranks it", async ({ page, context }, info) => {
  test.setTimeout(240_000);
  // "Unlock for correction" lives on the desktop score sheet.
  test.skip(Number(info.project.name.split("-")[1]) < 1024, "The Unlock button is on the desktop sheet");
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const id = `unl-qa-${randomUUID().slice(0, 8)}`;
  const origin = info.project.use.baseURL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Local fixture sessions only");
  const hq = await db.user.create({ data: { id: `${id}-hq`, name: "Unlock hq", email: `${id}-hq@unl-qa.invalid`, role: "admin", status: "active", approvalStatus: "approved" } });

  await db.series.create({ data: {
    id, slug: id, name: `Unlock QA ${id.slice(-8)}`, status: "live", isTraining: true, competitionDate: new Date(),
    zones: { create: ZONES.map(([number, divideBy]) => ({
      id: `${id}-z${number}`, number, name: `Zone ${number}`,
      inputs: { create: [{ id: `${id}-i${number}`, position: 1, label: `Movement ${number}`, divideBy }] },
    })) },
    waves: { create: [{ id: `${id}-w1`, number: 1, startTime: "09:00", capacity: 4, durationMinutes: 60, status: "running", startedAt: new Date(Date.now() - 5 * 60_000), endsAt: new Date(Date.now() + 55 * 60_000) }] },
  } });
  // Both fully submitted: RAW ORDER 4,477.10 first, GRIT WORKS 4,387.60 second.
  const teams = [
    ["RAW ORDER", ["Rania Zaid", "Dana Rahman"], [4190, 236, 250, 135]],
    ["GRIT WORKS", ["Youssef Darwish", "Nabil Mansour"], [4100, 236, 240, 240]],
  ] as const;
  for (const [index, [name, athletes, values]] of teams.entries()) {
    await db.team.create({ data: {
      id: `${id}-t${index + 1}`, seriesId: id, number: 180 + index, name, category: "Mens", division: "Pro", paymentStatus: "paid",
      wave: 1, waveId: `${id}-w1`, station: index + 1,
      competitors: { create: athletes.map((fullName, position) => ({ position: position + 1, fullName, normalizedName: fullName.toLowerCase() })) },
      score: { create: {
        status: "submitted", submittedAt: new Date(),
        entries: { create: values.map((value, zone) => ({ inputId: `${id}-i${zone + 1}`, value })) },
        zones: { create: [1, 2, 3, 4].map((zone) => ({ zoneId: `${id}-z${zone}`, status: "submitted" as const, submittedAt: new Date() })) },
      } },
    } });
  }

  await context.addCookies([
    { name: "podium_locale", value: locale, url: origin },
    { name: process.env.MOBILE_QA_PRODUCTION === "1" ? "__Secure-next-auth.session-token" : "next-auth.session-token", secure: process.env.MOBILE_QA_PRODUCTION === "1", url: origin, value: await encode({ secret: process.env.NEXTAUTH_SECRET!,
      token: { sub: hq.id, id: hq.id, email: hq.email, name: hq.name, role: "admin", studioId: null, status: "active", locale, expiresAt: Date.now() + 3_600_000, refreshedAt: Date.now() } }) },
  ]);
  await mkdir(".mobile-qa/board", { recursive: true });
  const ranking = page.locator(".running-grid .zone-row:visible");
  const board = async () => {
    await page.goto(`/series/${id}/board`);
    await expect(page.locator("html")).toHaveAttribute("data-mobile-ready", "true");
    return ranking.allInnerTexts();
  };

  try {
    let rows = await board();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("RAW ORDER");
    expect(rows[1]).toContain("GRIT WORKS");
    expect(rows[1]).toContain("4,387.60");

    // BFT MENA opens GRIT WORKS on the score sheet and unlocks it for correction.
    await page.goto(`/series/${id}/scores`);
    await expect(page.locator("html")).toHaveAttribute("data-mobile-ready", "true");
    await page.locator(".grid-team", { hasText: "GRIT WORKS" }).click();
    const editor = page.locator(".grid-expanded");
    await editor.getByRole("button", { name: t("Unlock for correction") }).click();
    await expect(editor.getByText(t("AWAITING SCORE"))).toBeVisible();
    expect((await db.score.findFirstOrThrow({ where: { teamId: `${id}-t2` } })).status).toBe("draft");

    // Unlocked — and still on the board, in its place, with its score.
    rows = await board();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain("GRIT WORKS");
    expect(rows[1]).toContain("4,387.60");
    await page.screenshot({ path: `.mobile-qa/board/${info.project.name}-unlocked.png` });

    // The correction: Zone 1 is 4,500, not 4,100. Saved, it re-ranks the team.
    await page.goto(`/series/${id}/scores`);
    await expect(page.locator("html")).toHaveAttribute("data-mobile-ready", "true");
    await page.locator(".grid-team", { hasText: "GRIT WORKS" }).click();
    await editor.locator('input[type="number"]').first().fill("4500");
    await editor.getByRole("button", { name: t("Submit score") }).click();
    await expect(editor.getByText(t("Saved. The board is updated."))).toBeVisible();

    rows = await board();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("GRIT WORKS");
    expect(rows[0]).toContain("4,787.60");
    expect(rows[1]).toContain("RAW ORDER");
    expect((await db.score.findFirstOrThrow({ where: { teamId: `${id}-t2` } })).status).toBe("submitted");
    await page.screenshot({ path: `.mobile-qa/board/${info.project.name}-corrected.png` });
  } finally {
    await db.series.delete({ where: { id } });
    await db.user.delete({ where: { id: hq.id } });
  }
});
