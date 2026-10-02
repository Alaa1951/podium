/** Independent prize brackets and their 15-second playlist in the actual app. */
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { createTranslator } from "../src/lib/i18n/dictionary";
import { BRACKETS } from "../src/lib/scoring";
import type { BoardPayload } from "../src/lib/board";

loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Board fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

for (const surface of ["signed-in", "public"] as const) {
  test(`${surface}: separate brackets, pages first, 15-second turns and uninterrupted polls`, async ({ page, context }, info) => {
    const locale = info.project.name.includes("-ar-") ? "ar" : "en";
    const t = createTranslator(locale);
    const id = `rotate-qa-${randomUUID().slice(0, 8)}`;
    const origin = info.project.use.baseURL!;
    const hq = await db.user.create({ data: {
      id: `${id}-hq`, name: "Rotation QA", email: `${id}@rotation-qa.invalid`, role: "admin", status: "active", approvalStatus: "approved",
    } });
    try {
      await db.series.create({ data: {
        id, slug: id, name: `Rotation QA ${id}`, status: "live", isTraining: true, competitionDate: new Date(),
        showTeamName: true, showCompetitorNames: true,
        zones: { create: [{ id: `${id}-z1`, number: 1, name: "Test zone", inputs: { create: [{ id: `${id}-i1`, position: 1, label: "Points", divideBy: 1 }] } }] },
        waves: { create: [1, 2].map((number) => ({
          id: `${id}-w${number}`, number, startTime: "09:00", capacity: 50, durationMinutes: 120,
          status: number === 1 ? "running" : "pending",
          startedAt: number === 1 ? new Date() : null,
          endsAt: number === 1 ? new Date(Date.now() + 120 * 60_000) : null,
        })) },
      } });
      let number = 0;
      for (const index of [3, 4, 5, 6, 7, 8, 0]) {
        const bracket = BRACKETS[index];
        for (let i = 0; i < (index === 3 ? 25 : 1); i++) {
          number++;
          const scored = index !== 0;
          const wave = number === 2 || index !== 3 ? 2 : 1;
          await db.team.create({ data: {
            id: `${id}-t${number}`, seriesId: id, number, name: `QA-${index}-${i + 1}`,
            category: bracket.category, division: bracket.division, paymentStatus: "paid", wave,
            waveId: number === 3 ? null : `${id}-w${wave}`, station: number,
            competitors: { create: [1, 2].map((position) => ({ position, fullName: `Athlete ${number}-${position}`, normalizedName: `athlete ${number} ${position}` })) },
            score: { create: {
              status: scored ? "submitted" : "draft",
              entries: { create: [{ inputId: `${id}-i1`, value: 1000 - number }] },
              zones: { create: scored ? [{ zoneId: `${id}-z1`, status: "submitted", submittedAt: new Date() }] : [] },
            } },
          } });
        }
      }
      await context.addCookies([
        { name: "podium_locale", value: locale, url: origin },
        ...(surface === "signed-in" ? [{ name: process.env.MOBILE_QA_PRODUCTION === "1" ? "__Secure-next-auth.session-token" : "next-auth.session-token",
          secure: process.env.MOBILE_QA_PRODUCTION === "1", url: origin, value: await encode({ secret: process.env.NEXTAUTH_SECRET!, token: {
          sub: hq.id, id: hq.id, email: hq.email, name: hq.name, role: "admin", studioId: null,
          status: "active", locale, expiresAt: Date.now() + 3_600_000, refreshedAt: Date.now(),
        } }) }] : []),
      ]);
      const api = surface === "public" ? `/api/live/${id}/board` : `/api/series/${id}/board`;
      const response = await page.request.get(api);
      expect(response.ok()).toBe(true);
      const payload = await response.json() as BoardPayload;
      expect(payload.waves.find((wave) => wave.number === 2)?.status).toBe("pending");
      expect(payload.teams.find((team) => team.number === 2)).toMatchObject({ scored: true, wave: 2 });
      expect(payload.teams.find((team) => team.number === 3)).toMatchObject({ scored: true, wave: null });
      let polls = 0;
      await page.route(`**${api}`, async (route) => { polls++; await route.fulfill({ json: payload }); });
      await page.clock.install();
      await page.goto(surface === "public" ? `/live/${id}` : `/series/${id}/board`);
      await page.waitForLoadState("networkidle");
      // A changed button state confirms hydration before pausing browser time.
      const board = page.getByTestId("running-board");
      const rows = board.locator(".zone-row");
      const chip = (index: number) => board.locator(`.board-bracket-chip[data-bracket="${index}"]`);
      const all = board.getByRole("button", { name: t("Rotate all brackets"), exact: true });
      const mobile = (info.project.use.viewport?.width ?? 1024) <= 900;
      if (mobile) {
        await board.getByRole("button", { name: t("Filters"), exact: true }).click();
        await expect(board.getByRole("dialog")).toBeVisible();
      }
      await chip(6).click();
      await expect(chip(6)).toHaveAttribute("aria-pressed", "true");
      await all.click();
      await expect(chip(6)).toHaveAttribute("aria-pressed", "false");
      await page.clock.pauseAt(new Date(Date.now() + 1000));
      // Align assertions with React's passive effect, not the click's instant.
      await page.evaluate(() => {
        const qaWindow = window as typeof window & { __boardTurns: number[] };
        qaWindow.__boardTurns = [];
        const previous = window.setInterval;
        window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
          if (delay === 15_000) qaWindow.__boardTurns.push(Date.now());
          return previous(handler, delay, ...args);
        }) as typeof window.setInterval;
      });

      const beforeNextTurn = async () => {
        await page.clock.runFor(100);
        const remaining = await page.evaluate(() => {
          const starts = (window as typeof window & { __boardTurns: number[] }).__boardTurns;
          return starts[starts.length - 1] + 15_000 - Date.now();
        });
        expect(remaining).toBeGreaterThan(14_000);
        await page.clock.runFor(remaining - 1);
      };
      const expectBracket = async (index: number, count: number) => {
        await expect(board).toHaveAttribute("data-bracket", String(index));
        await expect(rows).toHaveCount(count);
        await expect(chip(index)).toHaveAttribute("aria-current", "true");
        await expect(board.locator("h1")).toHaveText(`${t(BRACKETS[index].category)} ${t(BRACKETS[index].division)}`);
      };

      // Reset the cycle after loading so the timing assertion starts at zero.
      await all.click();
      await expectBracket(3, 12);
      await expect(rows.first().locator(".rank-disc")).toHaveText("1");
      await expect(rows.nth(1)).toContainText("QA-3-2");
      await expect(rows.nth(1).locator(".rank-disc")).toHaveText("2");
      await expect(rows.nth(2)).toContainText("QA-3-3");
      await expect(rows.nth(2).locator(".rank-disc")).toHaveText("3");
      await beforeNextTurn();
      await expectBracket(3, 12);
      await expect(rows.first()).toContainText("QA-3-1");
      await page.clock.runFor(2);
      await expect(rows.first().locator(".rank-disc")).toHaveText("13");
      await page.clock.runFor(15_000);
      await expectBracket(3, 1);
      await expect(rows.first().locator(".rank-disc")).toHaveText("25");
      await page.clock.runFor(15_000);
      await expectBracket(4, 1);
      await expect(rows.first().locator(".rank-disc")).toHaveText("1");
      for (const index of [5, 6, 7, 8, 3]) {
        await page.clock.runFor(15_000);
        await expectBracket(index, index === 3 ? 12 : 1);
      }
      expect(polls).toBeGreaterThan(0);
      await expect(board.locator('.floor-panel [data-rank], .floor-panel .rank-disc')).toHaveCount(0);

      // Two selections remain two screens, with a fresh 15 seconds per screen.
      await chip(6).click();
      await chip(7).click();
      await expectBracket(6, 1);
      await expect(chip(6)).toHaveAttribute("aria-pressed", "true");
      await expect(chip(7)).toHaveAttribute("aria-pressed", "true");
      await beforeNextTurn();
      await expectBracket(6, 1);
      await page.clock.runFor(2);
      await expectBracket(7, 1);
      await expect(rows.first().locator(".rank-disc")).toHaveText("1");
      await page.clock.runFor(15_000);
      await expectBracket(6, 1);

      // Pause the display; scores still arrive and the next resume gets 15s.
      await board.getByRole("button", { name: t("Auto-rotate on"), exact: true }).click();
      const mixed = payload.teams.find((team) => team.category === "Mixed" && team.division === "Rookie")!;
      mixed.total = 5555;
      await page.clock.runFor(30_000);
      await expectBracket(6, 1);
      await expect(rows.first()).toContainText("5,555.00");
      await board.getByRole("button", { name: t("Auto-rotate off"), exact: true }).click();
      await beforeNextTurn();
      await expectBracket(6, 1);
      await page.clock.runFor(2);
      await expectBracket(7, 1);

      // A single selected empty bracket waits, then starts on its first score.
      await all.click();
      await chip(0).click();
      await expectBracket(0, 0);
      const woman = payload.teams.find((team) => team.category === "Womens")!;
      woman.scored = true;
      woman.total = 42;
      await page.clock.runFor(15_000);
      await expectBracket(0, 1);
      await expect(rows.first().locator(".rank-disc")).toHaveText("1");
      await page.clock.runFor(30_000);
      await expectBracket(0, 1);

      // Clearing all selections restores the full ordered cycle, including Women.
      await all.click();
      await page.clock.runFor(100);
      for (const index of [3, 3, 4, 5, 6, 7, 8, 0, 3]) {
        await page.clock.runFor(15_000);
        await expect(board).toHaveAttribute("data-bracket", String(index));
      }
      if (mobile) {
        await board.getByRole("button", { name: t("Done"), exact: true }).click();
        await expect(board.getByRole("dialog")).not.toBeVisible();
        const heads = await board.locator(".zone-head > div:not(.zone-col)").evaluateAll((cells) =>
          cells.map((cell) => cell.getBoundingClientRect().y),
        );
        expect(Math.max(...heads) - Math.min(...heads)).toBeLessThan(2);
      }
      await page.screenshot({ path: `.mobile-qa/board/${info.project.name}-${surface}-rotation.png`, fullPage: true, animations: "disabled" });
    } finally {
      await db.series.deleteMany({ where: { id } });
      await db.user.deleteMany({ where: { id: hq.id } });
    }
  });
}
