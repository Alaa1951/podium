/**
 * ON THE DAY, AT THE ATHLETE'S REQUEST — the Edit button beside each athlete
 * on a team's page, walked in a real browser after team changes have closed.
 *
 *   THE ORGANISER  corrects the partner's email (the CRM put the payer's on
 *                  both seats): refused to save until the athlete's request
 *                  is ticked; the partner's phone and check-in stay.
 *   THE GYM        replaces its athlete's partner with somebody new, from its
 *                  own team page, on the same tick.
 *   A JUDGE        has no Edit button anywhere.
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
  throw new Error("Desk edit fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

type Person = { id: string; name: string; email: string; role: Role; studioId: string | null };

test("on the day, staff correct or replace an athlete at the athlete's request", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const suffix = randomUUID().slice(0, 8);
  const id = `dskedit-qa-${suffix}`;
  const origin = info.project.use.baseURL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Local fixture sessions only");

  const gym = `${id}-gym`;
  await db.studio.create({ data: { id: gym, name: `Edit gym ${suffix}` } });
  const roles: Record<string, string> = {};
  for (const key of ["organiser", "judge", "gym-studio"]) {
    const def = systemRole(key)!;
    roles[key] = (await db.accessRole.create({ data: { key: `${id}-${key}`, name: `${def.name} ${suffix}`, permissions: def.permissions, assignableBy: def.assignableBy } })).id;
  }
  const person = async (key: string, role: Role, roleKey: string, studioId: string | null = null): Promise<Person> => {
    const user = await db.user.create({ data: {
      id: `${id}-${key}`, name: `Edit ${key}`, email: `${id}-${key}@dskedit-qa.invalid`, role, status: "active", approvalStatus: "approved", studioId,
      accessRoles: { create: { accessRoleId: roles[roleKey] } },
    } });
    return { id: user.id, name: user.name!, email: user.email, role, studioId };
  };
  const organiser = await person("organiser", "organiser", "organiser");
  const judge = await person("judge", "organiser", "judge");
  const gymOwner = await person("gym", "studio", "gym-studio", gym);

  // The competition starts in a few hours: team changes closed yesterday.
  await db.series.create({ data: {
    id, slug: id, name: `Desk edit QA ${suffix}`, status: "live", competitionDate: new Date(Date.now() + 4 * 3_600_000), boardOpensAt: new Date(0),
    studios: { create: { studioId: gym } },
  } });
  const payer = `bedair-${suffix}@dskedit-qa.invalid`;
  const arrived = new Date();
  const teamId = `${id}-t1`;
  await db.team.create({ data: {
    id: teamId, seriesId: id, number: 130, name: "WILD HORSES", category: "Mens", division: "Open", paymentStatus: "paid", studioId: gym,
    competitors: { create: [
      { id: `${id}-s1`, position: 1, fullName: "Mohammad Bedair", normalizedName: "mohammad bedair", email: payer, phone: "+97450496040" },
      { id: `${id}-s2`, position: 2, fullName: "Zaid Banifadl", normalizedName: "zaid banifadl", email: payer, phone: "55234106", attendedAt: arrived },
    ] },
  } });

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
  await mkdir(".mobile-qa/desk-edit", { recursive: true });
  const seat = (n: number) => db.competitor.findUniqueOrThrow({ where: { id: `${id}-s${n}` } });
  const athlete = (page: Page, n: number) => page.getByTestId(`athlete-${n}`).filter({ visible: true });

  try {
    // ── 1. The organiser corrects Zaid's email, at his request ───────────────
    const desk = await as(organiser);
    await visit(desk, `/series/${id}/registrations/${teamId}`);
    await expect(desk.getByTestId("team-athletes").filter({ visible: true })).toBeVisible();
    await athlete(desk, 2).getByTestId("athlete-edit-2").click();
    await athlete(desk, 2).getByLabel(t("Email")).fill(`zaid-${suffix}@dskedit-qa.invalid`);
    const save = athlete(desk, 2).getByTestId("athlete-save");
    await expect(save).toBeDisabled();
    await athlete(desk, 2).getByTestId("athlete-asked").check();
    await desk.screenshot({ path: `.mobile-qa/desk-edit/${info.project.name}-correct.png` });
    await save.click();
    await expect(athlete(desk, 2).getByTestId("athlete-done")).toBeVisible();
    await expect.poll(async () => (await seat(2)).email).toBe(`zaid-${suffix}@dskedit-qa.invalid`);
    expect(await seat(2)).toMatchObject({ fullName: "Zaid Banifadl", phone: "55234106", attendedAt: arrived });
    expect(await seat(1)).toMatchObject({ email: payer });
    const line = await db.adminAuditLog.findFirstOrThrow({ where: { action: "registration.updated", targetId: teamId } });
    expect(line).toMatchObject({ actorId: organiser.id });
    expect(line.detail).toContain("staff-assisted");

    // ── 2. The gym replaces its athlete's partner, from its own team page ────
    const owner = await as(gymOwner);
    await visit(owner, `/studio/${id}/teams/${teamId}`);
    await athlete(owner, 2).getByTestId("athlete-edit-2").click();
    await athlete(owner, 2).getByTestId("athlete-replace").click();
    await athlete(owner, 2).getByTestId("athlete-replace-name").fill("Omar Aziz");
    await athlete(owner, 2).getByTestId("athlete-replace-email").fill(`omar-${suffix}@dskedit-qa.invalid`);
    await expect(athlete(owner, 2).getByTestId("athlete-save")).toBeDisabled();
    await athlete(owner, 2).getByTestId("athlete-asked").check();
    await athlete(owner, 2).getByTestId("athlete-save").click();
    await expect.poll(async () => (await seat(2)).fullName).toBe("Omar Aziz");
    expect(await seat(2)).toMatchObject({ email: `omar-${suffix}@dskedit-qa.invalid`, attendedAt: null, userId: null });
    expect((await db.team.findUniqueOrThrow({ where: { id: teamId } })).membershipVersion).toBe(1);
    await owner.screenshot({ path: `.mobile-qa/desk-edit/${info.project.name}-replaced.png` });

    // ── 3. A judge has no Edit button ───────────────────────────────────────
    const referee = await as(judge);
    await visit(referee, `/series/${id}/registrations/${teamId}`);
    await expect(referee.getByTestId("athlete-edit-2")).toHaveCount(0);
  } finally {
    for (const context of contexts) await context.close();
    await db.series.delete({ where: { id } });
    await db.adminAuditLog.deleteMany({ where: { actorId: { startsWith: id } } });
    await db.user.deleteMany({ where: { id: { startsWith: id } } });
    await db.accessRole.deleteMany({ where: { id: { in: Object.values(roles) } } });
    await db.studio.delete({ where: { id: gym } });
  }
});
