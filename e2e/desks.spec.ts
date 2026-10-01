/**
 * THE DESKS OF THE DAY, walked in a real browser, as each role.
 *
 * One small competition of its own (created here, removed at the end), and
 * the people of the day signed in side by side:
 *
 *   the ATHLETE     changes her own team's category and level on /me;
 *   a VOLUNTEER     checks people in at the entrance, one at a time and as a
 *                   team, helps an athlete change level, marks teams ready
 *                   in warm-up;
 *   an ORGANISER    finds both desks in the menu and helps from the
 *                   registration itself;
 *   BFT MENA        moves a team out of Pro — nobody else can;
 *   THE CUTOFF      24 hours before the start (the competition's setting) the
 *                   athlete and her gym are closed; the desk still changes it;
 *   a GYM           sees and checks in only its own teams, in its own area;
 *   a JUDGE, COACH  reach neither desk.
 *
 * Every step presses the button a person would press and then reads the
 * database, so "the screen said so" and "it is stored" are checked together.
 * The roles are copies of the shipped definitions, so an edited local Roles
 * screen cannot change what this proves.
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
  throw new Error("Desk fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

type Person = { id: string; name: string; email: string; role: Role; studioId: string | null };

test("athletes, staff and gyms at the entrance, the warm-up and the category / level change", async ({ browser }, info) => {
  test.setTimeout(420_000);
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const suffix = randomUUID().slice(0, 8);
  const id = `desk-qa-${suffix}`;
  const bracket = (category: Category, division: Division) => `${t(category)} · ${t(division)}`;

  // ── The competition ───────────────────────────────────────────────────────
  const gym = `${id}-gym`, rival = `${id}-rival`;
  await db.studio.createMany({ data: [{ id: gym, name: `Desk gym ${suffix}` }, { id: rival, name: `Desk rival ${suffix}` }] });
  const roles: Record<string, string> = {};
  for (const key of ["organiser", "volunteer", "judge", "coach", "gym-studio", "bft-partial", "athlete"]) {
    const def = systemRole(key)!;
    roles[key] = (await db.accessRole.create({ data: { key: `${id}-${key}`, name: `${def.name} ${suffix}`, permissions: def.permissions, assignableBy: def.assignableBy } })).id;
  }
  const person = async (key: string, role: Role, roleKey: string, extra: { studioId?: string; sex?: string } = {}): Promise<Person> => {
    const user = await db.user.create({
      data: {
        id: `${id}-${key}`, name: `Desk ${key}`, email: `${id}-${key}@desk-qa.invalid`, role, status: "active", approvalStatus: "approved", emailVerified: new Date(),
        studioId: extra.studioId ?? null, accessRoles: { create: { accessRoleId: roles[roleKey] } },
        ...(extra.sex ? { athleteProfile: { create: { sex: extra.sex } } } : {}),
      },
    });
    return { id: user.id, name: user.name!, email: user.email, role, studioId: user.studioId };
  };
  const organiser = await person("organiser", "organiser", "organiser");
  const volunteer = await person("volunteer", "organiser", "volunteer");
  const judge = await person("judge", "organiser", "judge");
  const coach = await person("coach", "organiser", "coach");
  const gymOwner = await person("gym", "studio", "gym-studio", { studioId: gym });
  const hq = await person("hq", "staff", "bft-partial");
  const sara = await person("sara", "competitor", "athlete", { sex: "f", studioId: gym });
  const lina = await person("lina", "competitor", "athlete", { sex: "f", studioId: gym });
  const omar = await person("omar", "competitor", "athlete", { sex: "m", studioId: gym });
  const people = [organiser, volunteer, judge, coach, gymOwner, hq, sara, lina, omar];

  await db.series.create({
    data: {
      id, slug: id, name: `Desk QA ${suffix}`, status: "live", competitionDate: new Date(Date.now() + 3 * 86_400_000), boardOpensAt: new Date(0),
      zones: { create: [1, 2].map((number) => ({ number, name: `Zone ${number}` })) },
      studios: { create: [{ studioId: gym }, { studioId: rival }] },
      waves: { create: [
        { id: `${id}-w1`, number: 1, startTime: "09:00", status: "running", startedAt: new Date(), endsAt: new Date(Date.now() + 3_600_000) },
        { id: `${id}-w2`, number: 2, startTime: "09:30" },
        { id: `${id}-w3`, number: 3, startTime: "10:00" },
      ] },
    },
  });
  type Seat = { fullName: string; userId?: string };
  const team = (number: number, name: string, category: Category, division: Division, studioId: string, wave: number | null, station: number | null, seats: Seat[], over: object = {}) =>
    db.team.create({
      data: {
        id: `${id}-t${number}`, seriesId: id, number, name, category, division, studioId, paymentStatus: "paid", paidAt: new Date(),
        waveId: wave ? `${id}-w${wave}` : null, wave: wave ?? 1, station, ...over,
        competitors: { create: seats.map((seat, index) => ({ position: index + 1, fullName: seat.fullName, normalizedName: seat.fullName.toLowerCase(), userId: seat.userId ?? null, studioId })) },
      },
    });
  await team(1, "DESK FALCONS", "Womens", "Open", gym, 2, 1, [{ fullName: sara.name, userId: sara.id }, { fullName: "Mona Saleh" }]);
  await team(2, "DESK HAWKS", "Mixed", "Open", gym, 2, 2, [{ fullName: lina.name, userId: lina.id }, { fullName: omar.name, userId: omar.id }]);
  await team(3, "DESK LIONS", "Mens", "Rookie", rival, 2, 3, [{ fullName: "Khalid Hamad" }, { fullName: "Yousef Karim" }]);
  await team(4, "DESK STORM", "Womens", "Rookie", rival, 1, 1, [{ fullName: "Noor Fahad" }, { fullName: "Dana Salem" }]);
  await team(5, "DESK PRO", "Mixed", "Pro", rival, 3, 1, [{ fullName: "Rana Tamer" }, { fullName: "Fahad Nabil" }]);
  await team(6, "DESK SOLO", "Womens", "Open", gym, 3, 2, [{ fullName: "Huda Nasser" }]);
  await team(7, "DESK DOOR", "Mixed", "Rookie", rival, null, null, [{ fullName: "Maya Adel" }, { fullName: "Tariq Sami" }], { paymentStatus: "pending", paidAt: null });
  await team(8, "DESK WAIT", "Womens", "Rookie", rival, null, null, [{ fullName: "Aya Zaid" }, { fullName: "Lama Hadi" }], { waitlistedAt: new Date() });
  // Team 4 is on the floor and already has a score: nobody moves its bracket.
  await db.score.create({ data: { teamId: `${id}-t4` } });
  for (const [user, category] of [[sara, "Womens"], [lina, "Mixed"], [omar, "Mixed"]] as const) {
    await db.seriesParticipant.create({ data: { seriesId: id, userId: user.id, category, division: "Open", lookingForPartner: false } });
  }

  const row = (number: number) => db.team.findUniqueOrThrow({ where: { id: `${id}-t${number}` }, include: { competitors: { orderBy: { position: "asc" } } } });
  const trail = (action: string) => db.adminAuditLog.findMany({ where: { action, actorId: { in: people.map((one) => one.id) } }, orderBy: { createdAt: "asc" } });

  // ── One browser per person ────────────────────────────────────────────────
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
    return context.newPage();
  };
  await mkdir(".mobile-qa/desks", { recursive: true });
  const capture = async (page: Page, name: string) => {
    await expect(page.locator("body")).not.toContainText("Application error");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name}: no sideways scroll`).toBe(true);
    await page.screenshot({ path: `.mobile-qa/desks/${info.project.name}-${name}.png`, fullPage: true });
  };
  // A screen can be in the document twice for a moment — the incoming one hidden while it streams
  // in — so everything is read from what is actually showing.
  const seen = (page: Page, selector: string) => page.locator(`${selector}:visible`);
  const card = (page: Page, number: number) => seen(page, `[data-testid="checkin-team-${number}"]`);
  const figures = (page: Page) => seen(page, ".checkin-totals .stat-value");
  const press = (scope: ReturnType<Page["locator"]>, name: string) => scope.getByRole("button", { name: t(name), exact: true });
  const choose = (scope: ReturnType<Page["locator"]> | Page, group: string, value: string) =>
    scope.getByRole("group", { name: t(group), exact: true }).getByRole("button", { name: t(value), exact: true });

  try {
    // ── 1. The athlete changes her own team ─────────────────────────────────
    const athlete = await as(sara);
    await visit(athlete, `/me?series=${id}`);
    const mine = seen(athlete, "#bracket");
    await expect(mine.locator(".badge")).toHaveText([t("Womens"), t("Open")]);
    await press(mine, "Change category or level").click();
    // She is registered as a woman: Mens is shown, refused, and says why. Pro is not hers to choose.
    await expect(choose(mine, "Category", "Mens")).toBeDisabled();
    await expect(mine).toContainText(t("Mens is not available: a member of this team is registered as a woman."));
    await expect(mine.getByRole("group", { name: t("Level"), exact: true }).getByRole("button")).toHaveText([t("Rookie"), t("Open")]);
    await expect(press(mine, "Save change")).toBeDisabled();
    // Open → Rookie, and Womens → Mixed, in one change.
    await choose(mine, "Category", "Mixed").click();
    await choose(mine, "Level", "Rookie").click();
    await expect(mine.getByTestId("bracket-summary")).toContainText(`${bracket("Womens", "Open")} → ${bracket("Mixed", "Rookie")}`);
    await capture(athlete, "athlete-change");
    await press(mine, "Save change").click();
    await expect(mine).toContainText(t("Saved. The team is now {bracket}.", { bracket: bracket("Mixed", "Rookie") }));
    await expect(mine.locator(".badge")).toHaveText([t("Mixed"), t("Rookie")]);
    expect(await row(1)).toMatchObject({ category: "Mixed", division: "Rookie", waveId: `${id}-w2`, station: 1 });
    expect(await db.seriesParticipant.findUniqueOrThrow({ where: { seriesId_userId: { seriesId: id, userId: sara.id } } })).toMatchObject({ category: "Mixed", division: "Rookie" });
    // …and back the other way: Rookie → Open, Mixed → Womens.
    await press(mine, "Change category or level").click();
    await choose(mine, "Category", "Womens").click();
    await choose(mine, "Level", "Open").click();
    await press(mine, "Save change").click();
    await expect(mine.locator(".badge")).toHaveText([t("Womens"), t("Open")]);
    const own = await trail("registration.bracket_changed");
    expect(own.map((line) => [line.actorId, line.targetId])).toEqual([[sara.id, `${id}-t1`], [sara.id, `${id}-t1`]]);
    expect(own[0].detail).toBe("category Womens → Mixed · level Open → Rookie · changed by the athlete, on their own team");

    // ── 2. A judge and a coach reach neither desk ───────────────────────────
    for (const outsider of [judge, coach]) {
      const page = await as(outsider);
      for (const desk of ["check-in", "warm-up"]) {
        await visit(page, `/series/${id}/${desk}`);
        // Refused: sent home, or — for an account the console lets in (the live
        // Judge role reads Wave control) — told the screen is not theirs. Never the desk.
        await expect(seen(page, ".checkin")).toHaveCount(0);
        if (new URL(page.url()).pathname.endsWith(`/${desk}`)) await expect(page.getByText("404", { exact: true })).toBeVisible();
      }
      await visit(page, "/home");
      await expect(page.locator(`a[href="/series/${id}/check-in"], a[href="/series/${id}/warm-up"]`)).toHaveCount(0);
    }

    // ── 3. A volunteer at the entrance ──────────────────────────────────────
    const desk = await as(volunteer);
    await visit(desk, "/home");
    await expect(seen(desk, `a[href="/series/${id}/check-in"]`).first()).toBeVisible();
    await visit(desk, `/series/${id}/check-in`);
    // Seven teams hold a place (the waiting one is not at the door); thirteen athletes.
    await expect(figures(desk)).toHaveText(["7", "0", "7", "13", "0", "13"]);
    await expect(card(desk, 8)).toHaveCount(0);
    await expect(card(desk, 7)).toContainText(t("Unpaid"));

    // One of two arrives: partly arrived, and only one person counted.
    await press(card(desk, 1).locator("li", { hasText: "Mona Saleh" }), "Check in").click();
    await expect(card(desk, 1)).toContainText(t("Partly arrived — {here} of {total}", { here: 1, total: 2 }));
    await expect(figures(desk)).toHaveText(["7", "0", "7", "13", "1", "12"]);
    await expect(seen(desk, ".checkin-totals")).toContainText(t("{count} partly arrived", { count: 1 }));
    expect((await row(1)).attendedAt).toBeNull();
    // Her partner arrives: now the team is checked in.
    await press(card(desk, 1).locator("li", { hasText: sara.name }), "Check in").click();
    await expect(card(desk, 1).locator(".checkin-team-head")).toContainText(t("Checked in"));
    await expect(figures(desk)).toHaveText(["7", "1", "6", "13", "2", "11"]);
    expect((await row(1)).attendedAt).not.toBeNull();
    // A whole team at once, and a one-seat team.
    await press(card(desk, 2), "Check in whole team").click();
    await expect(figures(desk)).toHaveText(["7", "2", "5", "13", "4", "9"]);
    await press(card(desk, 6), "Check in whole team").click();
    await expect(figures(desk)).toHaveText(["7", "3", "4", "13", "5", "8"]);
    // Check one athlete out: the team is partial again and the count drops by one person.
    await press(card(desk, 2).locator("li", { hasText: omar.name }), "Check out").click();
    await expect(figures(desk)).toHaveText(["7", "2", "5", "13", "4", "9"]);
    await press(card(desk, 2), "Check in whole team").click();
    await expect(figures(desk)).toHaveText(["7", "3", "4", "13", "5", "8"]);
    expect((await trail("registration.attendance_changed")).length).toBe(6);
    await capture(desk, "entrance");

    // Search and filters: every list is the count on its card.
    await seen(desk, 'input[type="search"]').fill("hawks");
    await expect(seen(desk, ".checkin-team")).toHaveCount(1);
    await seen(desk, 'input[type="search"]').fill(omar.name);
    await expect(seen(desk, ".checkin-team")).toHaveCount(1);
    await seen(desk, 'input[type="search"]').fill("");
    await desk.getByLabel(t("Check-in status"), { exact: true }).filter({ visible: true }).selectOption("in");
    await expect(seen(desk, ".checkin-team")).toHaveCount(3);
    await desk.getByLabel(t("Check-in status"), { exact: true }).filter({ visible: true }).selectOption("pending");
    await expect(seen(desk, ".checkin-team")).toHaveCount(4);
    await desk.getByLabel(t("Check-in status"), { exact: true }).filter({ visible: true }).selectOption("");
    await desk.getByLabel(t("Category"), { exact: true }).filter({ visible: true }).selectOption("Mixed");
    await expect(seen(desk, ".checkin-team")).toHaveCount(3);
    await desk.getByLabel(t("Level"), { exact: true }).filter({ visible: true }).selectOption("Open");
    await expect(seen(desk, ".checkin-team")).toHaveCount(1);
    await press(seen(desk, ".list-toolbar"), "Clear").click();
    await expect(seen(desk, ".checkin-team")).toHaveCount(7);
    // The totals by category and level are there, and pressing one filters to it.
    const womensOpen = seen(desk, ".checkin-bracket-card").filter({ hasText: bracket("Womens", "Open") });
    await expect(womensOpen).toContainText(t("Teams: {in} of {total} checked in", { in: 2, total: 2 }));
    await expect(womensOpen).toContainText(t("Athletes: {in} of {total} checked in", { in: 3, total: 3 }));
    await womensOpen.click();
    await expect(seen(desk, ".checkin-team")).toHaveCount(2);
    await womensOpen.click();

    // ── 4. The volunteer helps an athlete change level — with their approval ─
    await press(card(desk, 2), "Category / level…").click();
    const help = card(desk, 2).locator(".bracket-change:visible");
    // A woman and a man: neither Womens nor Mens. Pro is not a volunteer's to give.
    await expect(choose(help, "Category", "Womens")).toBeDisabled();
    await expect(choose(help, "Category", "Mens")).toBeDisabled();
    await choose(help, "Level", "Rookie").click();
    // Not without the confirmation.
    await expect(press(help, "Save change")).toBeDisabled();
    await help.getByRole("checkbox").check();
    await capture(desk, "entrance-assist");
    await press(help, "Save change").click();
    await expect(card(desk, 2)).toContainText(bracket("Mixed", "Rookie"));
    // Moved bracket, kept its check-in — on the card, in the totals, in the rows.
    await expect(card(desk, 2).locator(".checkin-team-head")).toContainText(t("Checked in"));
    await expect(figures(desk)).toHaveText(["7", "3", "4", "13", "5", "8"]);
    await expect(seen(desk, ".checkin-bracket-card").filter({ hasText: bracket("Mixed", "Rookie") })).toContainText(t("Teams: {in} of {total} checked in", { in: 1, total: 2 }));
    const hawks = await row(2);
    expect(hawks).toMatchObject({ category: "Mixed", division: "Rookie", waveId: `${id}-w2`, station: 2 });
    expect(hawks.attendedAt).not.toBeNull();
    const assistedLine = (await trail("registration.bracket_changed")).at(-1)!;
    expect(assistedLine).toMatchObject({ actorId: volunteer.id, targetId: `${id}-t2` });
    expect(assistedLine.detail).toBe("category Mixed (unchanged) · level Open → Rookie · staff-assisted: confirmed that the athlete asked for this change and approves it");
    // A team that already has a score: no change for anybody, and it says why.
    await press(card(desk, 4), "Category / level…").click();
    await expect(card(desk, 4).getByTestId("bracket-closed")).toHaveText(t("This team has a score, so its category and level cannot change now."));

    // ── 5. The volunteer at the warm-up desk ────────────────────────────────
    await visit(desk, `/series/${id}/warm-up`);
    const ready = seen(desk, ".checkin-figures .stat-value");
    await expect(ready).toHaveText(["7", "0", "7"]);
    await expect(seen(desk, ".warmup-group")).toHaveCount(4); // waves 1, 2, 3 and "not in a wave yet"
    const line = (number: number) => seen(desk, `[data-testid="warmup-team-${number}"]`);
    // Arrival is shown beside readiness, and is not readiness.
    await expect(line(1)).toContainText(t("Arrived"));
    await expect(line(1)).toContainText(t("Not ready yet"));
    await expect(line(3)).toContainText(t("Not arrived"));
    // Ready without having checked in at the entrance: refused, and the desk is told who is not here.
    await press(line(3), "Warm-up check-in").click();
    await expect(line(3).getByTestId("warmup-refusal")).toContainText("Khalid Hamad");
    await expect(line(3).getByTestId("warmup-refusal")).toContainText(t("Not checked in at the entrance"));
    await press(line(1), "Warm-up check-in").click();
    await expect(ready).toHaveText(["7", "1", "6"]);
    await expect(seen(desk, '[data-testid="warmup-wave-2"]')).toContainText(t("{count} ready", { count: 1 }));
    await expect(seen(desk, '[data-testid="warmup-wave-2"]')).toContainText(t("{count} pending", { count: 2 }));
    const lions = await row(3);
    expect(lions.warmupReadyAt).toBeNull();
    expect(lions.competitors.every((seat) => seat.attendedAt === null)).toBe(true);
    expect((await row(1)).warmupWaveId).toBe(`${id}-w2`); // ready for its own wave
    expect((await row(2)).warmupReadyAt).toBeNull(); // checked in at the entrance, and still not ready
    await capture(desk, "warm-up");
    // Filters: by readiness and by wave.
    await desk.getByLabel(t("Readiness"), { exact: true }).filter({ visible: true }).selectOption("ready");
    await expect(seen(desk, ".warmup-row")).toHaveCount(1);
    await desk.getByLabel(t("Readiness"), { exact: true }).filter({ visible: true }).selectOption("pending");
    await expect(seen(desk, ".warmup-row")).toHaveCount(6);
    await desk.getByLabel(t("Wave"), { exact: true }).filter({ visible: true }).selectOption(`${id}-w3`);
    await expect(seen(desk, ".warmup-row")).toHaveCount(2);
    await press(seen(desk, ".list-toolbar"), "Clear").click();
    // Warm-up check-out is one press, and leaves the entrance check-in where it was.
    await press(line(1), "Warm-up check-out").click();
    await expect(ready).toHaveText(["7", "0", "7"]);
    expect((await row(1)).attendedAt).not.toBeNull();
    expect((await trail("registration.warmup_changed")).map((entry) => entry.detail)).toEqual(["ready to compete in wave 2 (warm-up check-in)", "warm-up check-out: readiness cleared"]);

    // ── 6. An organiser: both desks in the menu, and help from the registration
    const floor = await as(organiser);
    await visit(floor, `/series/${id}/registrations/${id}-t5`);
    // On a phone the menu is behind "More", so the two desks are read from the document.
    await expect(floor.locator(`#console-nav a[href="/series/${id}/check-in"]`)).toHaveCount(1);
    await expect(floor.locator(`#console-nav a[href="/series/${id}/warm-up"]`)).toHaveCount(1);
    const pro = seen(floor, "#bracket");
    await press(pro, "Change category or level").click();
    // Out of Pro is BFT MENA's: the organiser is shown where the team is, and told.
    await expect(choose(pro, "Level", "Rookie")).toBeDisabled();
    await expect(choose(pro, "Level", "Open")).toBeDisabled();
    await expect(pro).toContainText(t("Moving into or out of Pro is done by BFT MENA."));
    await capture(floor, "registration-pro");
    // BFT MENA may.
    const office = await as(hq);
    await visit(office, `/series/${id}/registrations/${id}-t5`);
    const move = seen(office, "#bracket");
    await press(move, "Change category or level").click();
    await choose(move, "Level", "Open").click();
    await move.getByRole("checkbox").check();
    await press(move, "Save change").click();
    await expect(move.locator(".badge")).toHaveText([t("Mixed"), t("Open")]);
    expect(await row(5)).toMatchObject({ category: "Mixed", division: "Open" });

    // ── 7. A gym: its own teams only, in its own area ───────────────────────
    const owner = await as(gymOwner);
    await visit(owner, `/series/${id}/check-in`);
    // Sent to its own area; let that settle before going on.
    await expect(owner).toHaveURL(/\/studio(\/|$)/);
    await owner.waitForLoadState("networkidle");
    await visit(owner, `/studio/${id}/check-in`);
    await expect(seen(owner, ".checkin-team")).toHaveCount(3);
    await expect(figures(owner)).toHaveText(["3", "3", "0", "5", "5", "0"]);
    await expect(card(owner, 3)).toHaveCount(0); // the other gym's team is not there
    await visit(owner, `/studio/${id}/warm-up`);
    await expect(seen(owner, ".warmup-row")).toHaveCount(3);
    await press(seen(owner, '[data-testid="warmup-team-6"]'), "Warm-up check-in").click();
    await expect.poll(async () => (await row(6)).warmupReadyAt).not.toBeNull();
    // And the category / level button on its own team.
    await visit(owner, `/studio/${id}/teams/${id}-t6`);
    await press(seen(owner, ".mobile-detail"), "Change category or level").click();
    await choose(seen(owner, ".bracket-change"), "Level", "Rookie").click();
    await seen(owner, ".bracket-change").getByRole("checkbox").check();
    await press(seen(owner, ".bracket-change"), "Save change").click();
    await expect.poll(async () => (await row(6)).division).toBe("Rookie");
    // Its readiness came through the level change untouched.
    expect((await row(6)).warmupReadyAt).not.toBeNull();
    // Leaving the venue takes it back.
    await visit(owner, `/studio/${id}/check-in`);
    await owner.waitForLoadState("networkidle");
    await press(card(owner, 6), "Check out whole team").click();
    await expect(figures(owner)).toHaveText(["3", "2", "1", "5", "4", "1"]);
    expect((await row(6)).warmupReadyAt).toBeNull();
    await capture(owner, "gym-entrance");

    // The athlete's own page shows what the desks recorded.
    await visit(athlete, `/me?series=${id}`);
    await expect(seen(athlete, ".badge").filter({ hasText: t("Checked in") }).first()).toBeVisible();
    await capture(athlete, "athlete-day");

    // ── 8. The cutoff: teams close 24 hours before; BFT MENA and the desk do not ─
    // Two hours to go — past the competition's 24-hour cutoff.
    await db.series.update({ where: { id }, data: { competitionDate: new Date(Date.now() + 2 * 3_600_000) } });
    await visit(athlete, `/me?series=${id}`);
    await expect(seen(athlete, '#bracket [data-testid="bracket-closed"]')).toBeVisible();
    await expect(press(seen(athlete, "#bracket"), "Change category or level")).toHaveCount(0);
    await capture(athlete, "athlete-closed");
    // Her gym is on the same clock.
    await visit(owner, `/studio/${id}/teams/${id}-t1`);
    await expect(seen(owner, '.mobile-detail [data-testid="bracket-closed"]')).toBeVisible();
    // The desk still can, at her request — until her team has a score.
    await visit(desk, `/series/${id}/check-in`);
    await press(card(desk, 1), "Category / level…").click();
    const late = card(desk, 1).locator(".bracket-change:visible");
    await choose(late, "Level", "Rookie").click();
    await late.getByRole("checkbox").check();
    await press(late, "Save change").click();
    await expect.poll(async () => (await row(1)).division).toBe("Rookie");
    expect((await row(1)).attendedAt).not.toBeNull();
    // The cutoff is the competition's own setting: shortened to one hour, her button is back.
    await db.series.update({ where: { id }, data: { teamEditCloseHours: 1 } });
    await visit(athlete, `/me?series=${id}`);
    await expect(press(seen(athlete, "#bracket"), "Change category or level")).toBeVisible();
    await expect(seen(athlete, "#bracket").locator(".badge")).toHaveText([t("Womens"), t("Rookie")]);
  } finally {
    for (const context of contexts) await context.close();
    // Only this test's randomly named fixtures are removed.
    await db.series.delete({ where: { id } });
    await db.adminAuditLog.deleteMany({ where: { actorId: { in: people.map((one) => one.id) } } });
    await db.user.deleteMany({ where: { id: { in: people.map((one) => one.id) } } });
    await db.accessRole.deleteMany({ where: { id: { in: Object.values(roles) } } });
    await db.studio.deleteMany({ where: { id: { in: [gym, rival] } } });
  }
});
