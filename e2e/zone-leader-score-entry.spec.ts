import { test, expect, type Browser, type BrowserContext, type Page, type Request, type TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { createTranslator } from "../src/lib/i18n/dictionary";
import { visit } from "./support/visit";

loadEnvConfig(process.cwd());
const localHosts = ["localhost", "127.0.0.1", "[::1]"];
if (!process.env.DATABASE_URL || !localHosts.includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Zone leader fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

/** Fixture mutations are allowed only after BOTH database and browser origins are local. */
async function fixture(browser: Browser, info: TestInfo) {
  const origin = String(info.project.use.baseURL);
  if (!localHosts.includes(new URL(origin).hostname)) throw new Error("Local fixture sessions only");
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const id = `leader-qa-${randomUUID().slice(0, 8)}`;
  const contexts: BrowserContext[] = [];
  const leaderRole = await db.accessRole.findUniqueOrThrow({ where: { key: "zone-leaders" } });
  const judgeRole = await db.accessRole.findUniqueOrThrow({ where: { key: "judge" } });
  expect(leaderRole.permissions).toEqual(expect.arrayContaining(["judgeSheet.leaderView", "scores.enter"]));
  expect(leaderRole.permissions).not.toEqual(expect.arrayContaining(["judgeSheet.view"]));
  expect(judgeRole.permissions).toEqual(["judgeSheet.view", "scores.enter"]);
  const users = await Promise.all([
    db.user.create({ data: {
      id: `${id}-leader`, name: "Zone leader QA", email: `${id}-leader@leader-qa.invalid`, role: "organiser",
      status: "active", approvalStatus: "approved", accessRoles: { create: { accessRoleId: leaderRole.id } },
    } }),
    db.user.create({ data: {
      id: `${id}-judge`, name: "Station judge QA", email: `${id}-judge@leader-qa.invalid`, role: "organiser",
      status: "active", approvalStatus: "approved", accessRoles: { create: { accessRoleId: judgeRole.id } },
    } }),
    db.user.create({ data: {
      id: `${id}-admin`, name: "Local board QA", email: `${id}-admin@leader-qa.invalid`, role: "admin",
      status: "active", approvalStatus: "approved",
    } }),
  ]);
  const [leader, judge, admin] = users;
  const input = (number: number, kind = "reps") => `${id}-${kind}${number}`;
  const team = (wave = 2, station = 1) => `${id}-w${wave}t${station}`;
  const name = (wave = 2, station = 1) => `LEADER W${wave} STATION ${station}`;
  const zone = (number: number) => `${id}-z${number}`;
  try {
    await db.series.create({ data: {
      id, slug: id, name: `Leader QA ${id}`, status: "live", isTraining: true,
      competitionDate: new Date(), zoneWorkMinutes: 15, zoneBreakMinutes: 5, waveCapacity: 3,
      zones: { create: [1, 2, 3].map((number) => ({
        id: zone(number), number, name: `Zone ${number}`,
        inputs: { create: [
          { id: input(number), position: 1, label: "Reps", unit: "reps", multiplyBy: 10, maxValue: 9999 },
          { id: input(number, "rounds"), position: 2, label: "Rounds", unit: "rounds", multiplyBy: 5, maxValue: 9999 },
          { id: input(number, "metres"), position: 3, label: "Metres", unit: "m", divideBy: 100 },
        ] },
      })) },
      waves: { create: [
        { id: `${id}-w1`, number: 1, startTime: "09:00", capacity: 3, durationMinutes: 55,
          status: "running", startedAt: new Date(Date.now() - 41 * 60_000), endsAt: new Date(Date.now() + 14 * 60_000) },
        { id: `${id}-w2`, number: 2, startTime: "09:40", capacity: 3, durationMinutes: 55,
          status: "running", startedAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 54 * 60_000) },
        { id: `${id}-w3`, number: 3, startTime: "10:20", capacity: 3, durationMinutes: 55 },
      ] },
    } });
    for (const wave of [1, 2]) {
      for (const station of [1, 2, 3]) {
        await db.team.create({ data: {
          id: team(wave, station), seriesId: id, number: (wave - 1) * 3 + station, name: name(wave, station),
          category: "Mens", division: "Open", paymentStatus: "paid", wave, waveId: `${id}-w${wave}`, station,
          competitors: { create: [1, 2].map((position) => ({
            position, fullName: `Leader QA ${wave}-${station}-${position}`, normalizedName: `leader qa ${wave} ${station} ${position}`,
          })) },
          // Distinct private values make an accidental all-zone score payload observable.
          score: { create: { entries: { create: [{ inputId: input(2), value: 8871 + station }] } } },
        } });
      }
    }
    await db.zoneStaff.createMany({ data: [
      { seriesId: id, zoneId: zone(1), userId: leader.id, position: "leader" },
      { seriesId: id, zoneId: zone(3), userId: leader.id, position: "leader" },
      { seriesId: id, zoneId: zone(1), userId: judge.id, position: "judge", station: 1 },
    ] });
  } catch (error) {
    await db.series.deleteMany({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    throw error;
  }
  async function contextFor(user: typeof leader, desktop = false) {
    const context = await browser.newContext({
      ...info.project.use, baseURL: origin, serviceWorkers: "block",
      ...(desktop ? { viewport: { width: 1920, height: 900 } } : {}),
    });
    contexts.push(context);
    await context.addCookies([
      { name: "podium_locale", value: locale, url: origin },
      { name: process.env.MOBILE_QA_PRODUCTION === "1" ? "__Secure-next-auth.session-token" : "next-auth.session-token",
        secure: process.env.MOBILE_QA_PRODUCTION === "1", url: origin,
        value: await encode({ secret: process.env.NEXTAUTH_SECRET!, token: {
          sub: user.id, id: user.id, email: user.email, name: user.name, role: user.role, studioId: null,
          status: "active", locale, expiresAt: Date.now() + 3_600_000, refreshedAt: Date.now(),
        } }),
      },
    ]);
    return context;
  }
  const value = async (wave = 2, station = 1, zoneNumber = 1, kind = "reps") => (await db.zoneEntry.findFirst({
    where: { score: { teamId: team(wave, station) }, inputId: input(zoneNumber, kind) },
  }))?.value;
  async function shift(wave: number, elapsedMinutes: number) {
    await db.wave.update({ where: { id: `${id}-w${wave}` }, data: {
      status: "running", startedAt: new Date(Date.now() - elapsedMinutes * 60_000),
      endsAt: new Date(Date.now() + (55 - elapsedMinutes) * 60_000),
    } });
  }
  async function cleanup() {
    for (const context of contexts) await context.close();
    await db.series.deleteMany({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  }
  return { id, origin, leader, judge, admin, t, input, team, name, zone, value, shift, contextFor, cleanup };
}

function cardFor(page: Page, teamName: string, zoneNumber: number) {
  return page.locator(".zone-entry:visible").filter({ hasText: teamName })
    .filter({ has: page.locator(".zone-entry-foot").filter({ hasText: new RegExp(`(?:Zone|المنطقة|زون)\\s*${zoneNumber}\\b`) }) });
}

/** Use an action reference observed in a genuine autosave; never guess an action id. */
function captureSave(page: Page, teamId: string) {
  let request: Request | undefined;
  const capture = (next: Request) => {
    if (!next.headers()["next-action"]) return;
    try {
      const args = JSON.parse(next.postData() ?? "null") as unknown[];
      const first = args?.[0] as { teamId?: string; autosave?: boolean } | undefined;
      if (first?.teamId === teamId && first.autosave) request = next;
    } catch { /* Other server actions can encode FormData rather than this JSON argument. */ }
  };
  page.on("request", capture);
  return {
    async post(input: { teamId: string; zoneId: string; values: Record<string, number | null>; submit?: boolean }) {
      expect(request, "A real autosave must expose the current compiled action reference").toBeDefined();
      const headers = request!.headers();
      const response = await page.context().request.post(request!.url(), {
        headers: {
          "next-action": headers["next-action"], "content-type": headers["content-type"] ?? "text/plain;charset=UTF-8",
          origin: new URL(request!.url()).origin,
          ...(headers["next-router-state-tree"] ? { "next-router-state-tree": headers["next-router-state-tree"] } : {}),
        },
        data: JSON.stringify([{ ...input, submit: input.submit ?? false, autosave: true }]),
      });
      expect(response.status()).toBe(200);
      return response.text();
    },
    stop() { page.off("request", capture); },
  };
}

test("leader-only mobile sheet scopes scores, accepts typed counters, autosaves and submits", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const f = await fixture(browser, info);
  try {
    const wall = await (await f.contextFor(f.admin, true)).newPage();
    const live = wall.waitForResponse((response) => response.url().endsWith(`/api/series/${f.id}/events`) && response.status() === 200);
    await wall.goto(`/series/${f.id}/board`);
    await live;
    const phone = await (await f.contextFor(f.leader)).newPage();
    const response = await visit(phone, `/my-wave?series=${f.id}`);
    const html = (await response!.text()).replaceAll('\\"', '"');
    expect(html).not.toMatch(new RegExp(`"${f.input(2)}"\\s*:\\s*887[2-4]`));
    await expect(phone.getByRole("button", { name: f.t("Start wave"), exact: true })).toHaveCount(0);
    for (const station of [1, 2, 3]) {
      await expect(cardFor(phone, f.name(2, station), 1)).toHaveCount(1);
      await expect(cardFor(phone, f.name(1, station), 3)).toHaveCount(1);
    }
    await expect(phone.locator(".zone-entry-foot").filter({ hasText: new RegExp(`${f.t("Zone")}\\s*2\\b`) })).toHaveCount(0);
    const card = cardFor(phone, f.name(), 1);
    const reps = card.getByRole("spinbutton", { name: f.t("Reps"), exact: true });
    await expect(reps).toBeEnabled();
    await reps.fill("6");
    await expect.poll(() => f.value()).toBe(6);
    await card.getByRole("button", { name: `${f.t("Reps")} +1`, exact: true }).click();
    await expect.poll(() => f.value()).toBe(7);
    await card.getByRole("button", { name: `${f.t("Reps")} −1`, exact: true }).click();
    await expect.poll(() => f.value()).toBe(6);
    await card.getByRole("spinbutton", { name: f.t("Rounds"), exact: true }).fill("2");
    await card.getByRole("spinbutton", { name: f.t("Metres"), exact: true }).fill("250");
    await expect.poll(() => f.value(2, 1, 1, "rounds")).toBe(2);
    await expect.poll(() => f.value(2, 1, 1, "metres")).toBe(250);
    const row = wall.locator(".zone-row:visible").filter({ hasText: f.name() });
    // The board total includes the hidden Zone 2 privacy sentinel (8,872 × 10).
    await expect(row.locator(".display.num")).toHaveText("88,792.50", { timeout: 5_000 });
    await visit(phone, `/my-wave?series=${f.id}`);
    await expect(reps).toHaveValue("6");
    await expect(card.getByRole("spinbutton", { name: f.t("Rounds"), exact: true })).toHaveValue("2");

    // The other assigned zone and stations use the same writer, with no six-team hard cap.
    const last = cardFor(phone, f.name(1, 3), 3);
    await last.getByRole("spinbutton", { name: f.t("Reps"), exact: true }).fill("12");
    await expect.poll(() => f.value(1, 3, 3)).toBe(12);
    await card.getByRole("spinbutton", { name: f.t("Metres"), exact: true }).fill("300");
    phone.once("dialog", (dialog) => { void dialog.accept(); });
    await card.getByRole("button", { name: f.t("Submit zone"), exact: true }).click();
    await expect(card.locator(".badge")).toHaveText(f.t("Submitted"));
    await expect(reps).toBeDisabled();
    await expect.poll(() => f.value(2, 1, 1, "metres")).toBe(300);
    await expect(row.locator(".display.num")).toHaveText("88,793.00", { timeout: 5_000 });
    expect(await db.zoneScore.count({ where: { score: { teamId: f.team() }, zoneId: f.zone(1), status: "submitted" } })).toBe(1);
    expect(await db.scoreAudit.count({ where: { score: { teamId: f.team() }, operatorId: f.leader.id } })).toBeGreaterThan(0);

    // Judge keeps the existing display + counters, including while the leader sees a typed box.
    const judge = await (await f.contextFor(f.judge)).newPage();
    await visit(judge, `/my-wave?series=${f.id}`);
    const judgeCard = cardFor(judge, f.name(), 1);
    await expect(judgeCard.getByRole("spinbutton", { name: f.t("Reps"), exact: true })).toHaveCount(0);
    await expect(judgeCard.locator(".team-entry-count-value").first()).toHaveText("6");
    await expect(judge.locator(".zone-entry:visible")).toHaveCount(1);
  } finally { await f.cleanup(); }
});

test("leader server action refuses forged zones, closed windows, ended/reset waves and revoked posts", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const f = await fixture(browser, info);
  try {
    const phone = await (await f.contextFor(f.leader)).newPage();
    await visit(phone, `/my-wave?series=${f.id}`);
    const action = captureSave(phone, f.team());
    const card = cardFor(phone, f.name(), 1);
    await card.getByRole("spinbutton", { name: f.t("Reps"), exact: true }).fill("5");
    await expect.poll(() => f.value()).toBe(5);
    const post = (zone = 1, value = 8, wave = 2) => action.post({
      teamId: f.team(wave), zoneId: f.zone(zone), values: { [f.input(zone)]: value },
    });
    expect(await post(2)).toContain('"error":"FORBIDDEN"');
    expect(await f.value(2, 1, 2)).toBe(8872);
    for (const invalid of [-1, 1.5, 10000]) expect(await post(1, invalid)).toMatch(/"error":"INVALID_(?:INPUT|SCORE)"/);
    expect(await f.value()).toBe(5);

    await f.shift(2, 16); // Changeover remains writable.
    expect(await post(1, 9)).toContain('"ok":true');
    expect(await f.value()).toBe(9);
    await f.shift(2, 21); // Past its break, with no next wave at this zone.
    expect(await post(1, 10)).toContain('"error":"ZONE_ENTRY_CLOSED"');
    expect(await f.value()).toBe(9);
    await visit(phone, `/my-wave?series=${f.id}`);
    await expect(card.getByRole("spinbutton", { name: f.t("Reps"), exact: true })).toBeDisabled();
    const judge = await (await f.contextFor(f.judge)).newPage();
    await visit(judge, `/my-wave?series=${f.id}`);
    const judgeCard = cardFor(judge, f.name(), 1);
    await expect(judgeCard.getByRole("spinbutton", { name: f.t("Reps"), exact: true })).toHaveCount(0);
    await judgeCard.getByRole("button", { name: `${f.t("Reps")} +1`, exact: true }).click();
    await expect.poll(() => f.value()).toBe(10);

    await f.shift(1, 56); // Last zone has no break after its work.
    expect(await post(3, 10, 1)).toContain('"error":"ZONE_ENTRY_CLOSED"');
    await f.shift(2, 1);
    await db.wave.update({ where: { id: `${f.id}-w2` }, data: { status: "complete", endsAt: new Date() } });
    expect(await post()).toContain('"error":"ZONE_ENTRY_CLOSED"');
    await db.wave.update({ where: { id: `${f.id}-w2` }, data: { status: "pending", startedAt: null, endsAt: null } });
    expect(await post()).toContain('"error":"WAVE_NOT_HERE"');
    await f.shift(2, 1);
    await db.zoneStaff.delete({ where: { zoneId_userId: { zoneId: f.zone(1), userId: f.leader.id } } });
    expect(await post()).toContain('"error":"FORBIDDEN"');
    await db.zoneStaff.create({ data: { seriesId: f.id, zoneId: f.zone(1), userId: f.leader.id, position: "leader" } });
    await db.user.update({ where: { id: f.leader.id }, data: { permissionOverrides: { deny: ["scores.enter"] } } });
    expect(await post()).toContain('"error":"FORBIDDEN"');
    expect(await f.value()).toBe(10);
    action.stop();
  } finally { await f.cleanup(); }
});

test("a settled leader card refreshes another judge's saved values before submission", async ({ browser }, info) => {
  const f = await fixture(browser, info);
  try {
    const phone = await (await f.contextFor(f.leader)).newPage();
    await visit(phone, `/my-wave?series=${f.id}`);
    const card = cardFor(phone, f.name(), 1);
    const reps = card.getByRole("spinbutton", { name: f.t("Reps"), exact: true });
    await reps.fill("7");
    await expect.poll(() => f.value()).toBe(7);
    await expect(card).not.toHaveAttribute("data-dirty", "true");
    await reps.blur();

    const judge = await (await f.contextFor(f.judge)).newPage();
    await visit(judge, `/my-wave?series=${f.id}`);
    const judgeCard = cardFor(judge, f.name(), 1);
    await judgeCard.getByRole("button", { name: `${f.t("Reps")} −1`, exact: true }).click();
    await expect.poll(() => f.value()).toBe(6);
    await expect(reps).toHaveValue("6"); // Automatic server refresh, without a full reload.
    await card.getByRole("spinbutton", { name: f.t("Rounds"), exact: true }).fill("2");
    await card.getByRole("spinbutton", { name: f.t("Metres"), exact: true }).fill("250");
    await expect.poll(() => f.value(2, 1, 1, "metres")).toBe(250);
    phone.once("dialog", (dialog) => { void dialog.accept(); });
    await card.getByRole("button", { name: f.t("Submit zone"), exact: true }).click();
    await expect(card.locator(".badge")).toHaveText(f.t("Submitted"));
    await expect(reps).toHaveValue("6");
    expect(await f.value()).toBe(6);
  } finally { await f.cleanup(); }
});

test("a delayed pre-save sheet refresh cannot rewind acknowledged judge counters", async ({ browser }, info) => {
  const f = await fixture(browser, info);
  let release = () => {};
  try {
    const phone = await (await f.contextFor(f.judge)).newPage();
    await visit(phone, `/my-wave?series=${f.id}`);
    const card = cardFor(phone, f.name(), 1);
    const plus = card.getByRole("button", { name: `${f.t("Reps")} +1`, exact: true });
    let captured = false;
    let fetched = false;
    let delivered = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await phone.route("**/my-wave?**", async (route) => {
      if (captured || route.request().method() !== "GET" || route.request().headers().rsc !== "1") {
        await route.continue();
        return;
      }
      captured = true;
      const oldSnapshot = await route.fetch();
      fetched = true;
      await gate;
      await route.fulfill({ response: oldSnapshot });
      delivered = true;
    });
    // The normal five-second sheet poll captures the actual old server payload.
    await expect.poll(() => fetched).toBe(true);
    for (let i = 0; i < 6; i++) await plus.click();
    await expect.poll(() => f.value()).toBe(6);
    await expect(card).not.toHaveAttribute("data-dirty", "true");
    release();
    await expect.poll(() => delivered).toBe(true);
    await phone.waitForLoadState("networkidle");
    await expect(card.locator(".team-entry-count-value").first()).toHaveText("6");
    await card.getByRole("button", { name: `${f.t("Reps")} −1`, exact: true }).click();
    await expect.poll(() => f.value()).toBe(5);
  } finally { release(); await f.cleanup(); }
});

test("a request waiting on the wave lock and an offline retry cannot save after the leader deadline", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const f = await fixture(browser, info);
  try {
    const context = await f.contextFor(f.leader);
    const phone = await context.newPage();
    await visit(phone, `/my-wave?series=${f.id}`);
    const action = captureSave(phone, f.team());
    const card = cardFor(phone, f.name(), 1);
    await card.getByRole("spinbutton", { name: f.t("Reps"), exact: true }).fill("3");
    await expect.poll(() => f.value()).toBe(3);
    let request: Promise<string> | undefined;
    await db.$transaction(async (tx) => {
      const waveId = `${f.id}-w2`;
      await tx.$queryRaw`SELECT id FROM Wave WHERE id = ${waveId} FOR UPDATE`;
      request = action.post({ teamId: f.team(), zoneId: f.zone(1), values: { [f.input(1)]: 20 } });
      // Hold the local lock long enough for the HTTP request to arrive, then close its zone.
      await phone.waitForTimeout(1_000);
      await tx.wave.update({ where: { id: waveId }, data: {
        status: "complete", endsAt: new Date(),
      } });
    }, { timeout: 10_000 });
    expect(await request!).toContain('"error":"ZONE_ENTRY_CLOSED"');
    expect(await f.value()).toBe(3);

    await f.shift(2, 1);
    await visit(phone, `/my-wave?series=${f.id}`);
    await context.setOffline(true);
    await card.getByRole("spinbutton", { name: f.t("Reps"), exact: true }).fill("25");
    await expect(card.getByRole("alert")).toBeVisible();
    await f.shift(2, 21);
    await context.setOffline(false);
    await expect(card).toContainText(f.t("Score entry for this zone has ended. Ask BFT MENA for any correction."));
    await expect(card.getByRole("button", { name: f.t("Try again"), exact: true })).toHaveCount(0);
    expect(await f.value()).toBe(3);
    await expect(card.getByRole("spinbutton", { name: f.t("Reps"), exact: true })).toBeDisabled();
    action.stop();
  } finally { await f.cleanup(); }
});

for (const platform of ["ios", "android"] as const) {
  test(`${platform} app shell simulation keeps the leader's numeric entry usable on a phone`, async ({ browser }, info) => {
    const f = await fixture(browser, info);
    try {
      const context = await f.contextFor(f.leader);
      await context.addInitScript((platform) => {
        const surface = window as typeof window & { CapacitorCustomPlatform?: { name: string }; Capacitor?: unknown };
        surface.CapacitorCustomPlatform = { name: platform };
        surface.Capacitor = {
          isNativePlatform: () => true, getPlatform: () => platform,
          PluginHeaders: [{ name: "StatusBar", methods: [{ name: "getInfo", rtype: "promise" }, { name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "promise" }] }],
          nativePromise: async () => ({ visible: true, overlays: true, height: 59 }),
          nativeCallback: () => "leader-shell-test-listener",
        };
        if (platform === "android") {
          const inset = () => {
            document.documentElement.style.setProperty("--safe-area-inset-top", "36px");
            document.documentElement.style.setProperty("--safe-area-inset-bottom", "24px");
          };
          if (document.documentElement) inset(); else document.addEventListener("DOMContentLoaded", inset, { once: true });
        }
      }, platform);
      const phone = await context.newPage();
      await visit(phone, `/my-wave?series=${f.id}`);
      await expect(phone.locator("html")).toHaveAttribute("data-native", "true");
      const card = cardFor(phone, f.name(), 1);
      const reps = card.getByRole("spinbutton", { name: f.t("Reps"), exact: true });
      await reps.fill("12");
      await expect.poll(() => f.value()).toBe(12);
      await expect.poll(() => phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await card.scrollIntoViewIfNeeded();
      await phone.screenshot({ path: info.outputPath(`${platform}-leader.png`), fullPage: true });
      await f.shift(2, 21);
      await visit(phone, `/my-wave?series=${f.id}`);
      await expect(reps).toBeDisabled();
      expect(await f.value()).toBe(12);
    } finally { await f.cleanup(); }
  });
}
