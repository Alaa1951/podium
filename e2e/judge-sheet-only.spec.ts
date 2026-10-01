/**
 * A JUDGE SEES THEIR OWN SHEET, AND NOTHING ELSE — walked in a real browser.
 *
 * An organiser-type account holding the Judge role, placed on Zone 1,
 * station 2, while wave 1 is on the floor: signing in lands on the judge
 * sheet with their zone, their station and the ONE team standing on it. The
 * other teams of the wave are not on the page, and every screen that lists
 * the whole field — Waves, Score entry, Wave control, Marshalling, Athletes —
 * sends them back.
 *
 * The role is the real stored "judge" row (as the migration leaves it), not
 * a copy made for the test.
 */
import { test, expect } from "@playwright/test";
import { visit } from "./support/visit";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";

loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Judge fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

test("a judge sees their zone, their station and its team — never the whole field", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const id = `judge-qa-${randomUUID().slice(0, 8)}`;
  const origin = info.project.use.baseURL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Local fixture sessions only");

  const role = await db.accessRole.findUniqueOrThrow({ where: { key: "judge" } });
  expect(role.permissions).toEqual(["judgeSheet.view", "scores.enter"]);
  const judge = await db.user.create({ data: {
    id: `${id}-judge`, name: "Sheet judge", email: `${id}-judge@judge-qa.invalid`, role: "organiser", status: "active", approvalStatus: "approved",
    accessRoles: { create: { accessRoleId: role.id } },
  } });

  await db.series.create({ data: {
    id, slug: id, name: `Judge QA ${id.slice(-8)}`, status: "live", isTraining: true, competitionDate: new Date(),
    zoneWorkMinutes: 15, zoneBreakMinutes: 5, waveCapacity: 3,
    zones: { create: [1, 2].map((number) => ({
      id: `${id}-z${number}`, number, name: `Zone ${number}`,
      inputs: { create: [{ id: `${id}-i${number}`, position: 1, label: `Movement ${number}` }] },
    })) },
    waves: { create: [
      { id: `${id}-w1`, number: 1, startTime: "09:00", capacity: 3, durationMinutes: 35, status: "running", startedAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 34 * 60_000) },
      { id: `${id}-w2`, number: 2, startTime: "09:40", capacity: 3, durationMinutes: 35 },
    ] },
  } });
  const names = ["ALPHA STATION ONE", "BRAVO STATION TWO", "CHARLIE STATION THREE"];
  for (const [index, name] of names.entries()) {
    await db.team.create({ data: {
      id: `${id}-t${index + 1}`, seriesId: id, number: 300 + index, name, category: "Mens", division: "Open", paymentStatus: "paid",
      wave: 1, waveId: `${id}-w1`, station: index + 1,
      competitors: { create: [1, 2].map((position) => ({ position, fullName: `${name} ${position}`, normalizedName: `${name} ${position}`.toLowerCase() })) },
    } });
  }
  await db.zoneStaff.create({ data: { seriesId: id, zoneId: `${id}-z1`, userId: judge.id, position: "judge", station: 2 } });

  const context = await browser.newContext({ ...info.project.use, baseURL: origin });
  await context.addCookies([
    { name: "podium_locale", value: locale, url: origin },
    { name: "next-auth.session-token", url: origin, value: await encode({ secret: process.env.NEXTAUTH_SECRET!,
      token: { sub: judge.id, id: judge.id, email: judge.email, name: judge.name, role: "organiser", studioId: null, status: "active", locale, expiresAt: Date.now() + 3_600_000, refreshedAt: Date.now() } }) },
  ]);
  const page = await context.newPage();
  await mkdir(".mobile-qa/judge", { recursive: true });

  try {
    // Signing in lands on the sheet: their station's team, and only it.
    await visit(page, "/");
    await expect(page).toHaveURL(/\/my-wave/);
    await expect(page.locator("body")).toContainText("BRAVO STATION TWO");
    await expect(page.locator("body")).not.toContainText("ALPHA STATION ONE");
    await expect(page.locator("body")).not.toContainText("CHARLIE STATION THREE");
    await expect(page.locator("body")).not.toContainText("Application error");
    await page.screenshot({ path: `.mobile-qa/judge/${info.project.name}-sheet.png`, fullPage: true });

    // Every screen that lists the whole field sends them back.
    for (const section of ["waves", "scores", "wave-control", "marshalling", "registrations", "check-in", "settings", ""]) {
      await visit(page, `/series/${id}/${section}`);
      await expect(page, `/${section} is not the judge's`).not.toHaveURL(new RegExp(`/series/${id}/${section}$`));
      await expect(page.locator("body")).not.toContainText("ALPHA STATION ONE");
    }
    for (const path of ["/users", "/series", "/studios", "/approvals", "/roles"]) {
      await visit(page, path);
      await expect(page).not.toHaveURL(new RegExp(`${path}$`));
    }
  } finally {
    await context.close();
    await db.series.delete({ where: { id } });
    await db.user.delete({ where: { id: judge.id } });
  }
});
