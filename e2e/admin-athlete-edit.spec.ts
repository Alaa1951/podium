/**
 * BFT MENA FULL ACCESS CORRECTS ANY ATHLETE — the team name, each athlete's
 * name and email (the second athlete's included), walked in a real browser.
 *
 *   FULL ACCESS   renames the team although the partner's account and seat
 *                 disagree about her email (the refusal nobody typed); corrects
 *                 athlete 1's name and email; corrects athlete 2's sign-in
 *                 email only after ticking the confirmation, and her name on
 *                 her account.
 *   PARTIAL       (registrations.edit, not Full access) is told that a signed-in
 *                 athlete's email is changed on their account, and nothing moves.
 *   A JUDGE       has no edit form at all.
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
  throw new Error("Edit fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

type Person = { id: string; name: string; email: string; role: Role; studioId: null };

test("Full access corrects the team name and any athlete's name and email", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const suffix = randomUUID().slice(0, 8);
  const id = `edit-qa-${suffix}`;
  const origin = info.project.use.baseURL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Local fixture sessions only");

  // ── Who is who ────────────────────────────────────────────────────────────
  const partialRole = await db.accessRole.create({ data: { key: `${id}-partial`, name: `Edit partial ${suffix}`, permissions: [...systemRole("bft-partial")!.permissions, "registrations.edit"], assignableBy: "bft" } });
  const judgeRole = await db.accessRole.create({ data: { key: `${id}-judge`, name: `Edit judge ${suffix}`, permissions: systemRole("judge")!.permissions, assignableBy: "bft" } });
  const account = async (key: string, role: Role, accessRoleId?: string): Promise<Person> => {
    const user = await db.user.create({ data: {
      id: `${id}-${key}`, name: `Edit ${key}`, email: `${id}-${key}@edit-qa.invalid`, role, status: "active", approvalStatus: "approved",
      ...(accessRoleId ? { accessRoles: { create: { accessRoleId } } } : {}),
    } });
    return { id: user.id, name: user.name!, email: user.email, role, studioId: null };
  };
  const hq = await account("hq", "admin");
  const partial = await account("partial", "staff", partialRole.id);
  const judge = await account("judge", "organiser", judgeRole.id);
  // Athlete 2 signed in — her account now says sara@…, her seat still the address she registered with, and her name as typed then.
  await db.user.create({ data: { id: `${id}-sara`, name: "Sara Ali", email: `sara-${suffix}@edit-qa.invalid`, verifiedEmail: `sara-${suffix}@edit-qa.invalid`, role: "competitor", status: "active", approvalStatus: "approved" } });

  await db.series.create({ data: { id, slug: id, name: `Edit QA ${suffix}`, status: "scheduled", competitionDate: new Date(Date.now() + 10 * 86_400_000) } });
  const teamId = `${id}-t1`;
  await db.team.create({ data: {
    id: teamId, seriesId: id, number: 7, name: "FALCONS", category: "Womens", division: "Open", paymentStatus: "paid",
    ownership: "registrant", registrantEmail: `old-sara-${suffix}@edit-qa.invalid`, registrantUserId: `${id}-sara`,
    competitors: { create: [
      { id: `${id}-mona`, position: 1, fullName: "Mona Salah", normalizedName: "mona salah", email: `mona-${suffix}@edit-qa.invalid`, phone: "+97450000001" },
      { id: `${id}-seat-sara`, position: 2, fullName: "Sarah", normalizedName: "sarah", email: `old-sara-${suffix}@edit-qa.invalid`, userId: `${id}-sara` },
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
  await mkdir(".mobile-qa/admin-edit", { recursive: true });
  const editUrl = `/series/${id}/registrations/${teamId}/edit`;
  const athlete = (page: Page, n: number) => page.locator(".studio-editor-person:visible").nth(n - 1);
  const field = (scope: ReturnType<Page["locator"]>, label: string) => scope.locator("label").filter({ hasText: t(label) }).locator("input").first();
  const save = (page: Page) => page.getByRole("button", { name: t("Save changes"), exact: true });
  const team = () => db.team.findUniqueOrThrow({ where: { id: teamId }, include: { competitors: { orderBy: { position: "asc" } } } });
  const sara = () => db.user.findUniqueOrThrow({ where: { id: `${id}-sara` } });

  try {
    const office = await as(hq);

    // ── 1. The team name alone saves, though the partner's account and seat disagree ─
    await visit(office, editUrl);
    await expect(field(athlete(office, 2), "Email")).toHaveValue(`sara-${suffix}@edit-qa.invalid`);
    await expect(athlete(office, 2).getByTestId("account-email-note")).toBeVisible();
    await field(office.locator(".studio-editor"), "Team name").fill("Hawks");
    await save(office).click();
    await expect.poll(async () => (await team()).name).toBe("HAWKS");
    expect((await sara()).email).toBe(`sara-${suffix}@edit-qa.invalid`);

    // ── 2. Athlete 1 (no account): name and email corrected, nothing else lost ─
    await visit(office, editUrl);
    await field(athlete(office, 1), "Full name").fill("Mona Saleh");
    await field(athlete(office, 1), "Email").fill(`mona.saleh-${suffix}@edit-qa.invalid`);
    await expect(office.getByTestId("confirm-account-email")).toHaveCount(0);
    await save(office).click();
    await expect.poll(async () => (await team()).competitors[0].email).toBe(`mona.saleh-${suffix}@edit-qa.invalid`);
    expect((await team()).competitors[0]).toMatchObject({ fullName: "Mona Saleh", phone: "+97450000001" });

    // ── 3. Athlete 2 (signed in): her sign-in email, only on the tick; her name on her account ─
    await visit(office, editUrl);
    await field(athlete(office, 2), "Full name").fill("Sara M. Ali");
    await field(athlete(office, 2), "Email").fill(`sara.ali-${suffix}@edit-qa.invalid`);
    await expect(save(office)).toBeDisabled();
    await office.getByTestId("confirm-account-email").check();
    await office.screenshot({ path: `.mobile-qa/admin-edit/${info.project.name}-confirm.png` });
    await save(office).click();
    await expect.poll(async () => (await sara()).email).toBe(`sara.ali-${suffix}@edit-qa.invalid`);
    expect(await sara()).toMatchObject({ name: "Sara M. Ali", verifiedEmail: null });
    const after = await team();
    expect(after.competitors[1]).toMatchObject({ userId: `${id}-sara`, email: `sara.ali-${suffix}@edit-qa.invalid` });
    expect(after).toMatchObject({ registrantUserId: `${id}-sara`, registrantEmail: `sara.ali-${suffix}@edit-qa.invalid`, membershipVersion: 0 });
    // The team's page reads the corrected names.
    await expect(office.locator("body")).toContainText("Sara M. Ali");
    expect(await db.adminAuditLog.count({ where: { action: "account.updated", targetId: `${id}-sara` } })).toBe(1);

    // ── 4. Partial access: a signed-in athlete's email is not theirs to change ─
    const desk = await as(partial);
    await visit(desk, editUrl);
    await expect(desk.getByTestId("account-email-note")).toHaveCount(0);
    await field(athlete(desk, 2), "Email").fill(`someone-${suffix}@edit-qa.invalid`);
    await expect(desk.getByTestId("confirm-account-email")).toHaveCount(0);
    await save(desk).click();
    await expect(desk.locator(".notice-error[role=alert]")).toContainText(t("This person signs in with that email. Change it on their account (Users), or use Swap to put someone else in the team."));
    expect((await sara()).email).toBe(`sara.ali-${suffix}@edit-qa.invalid`);

    // ── 5. A judge has no edit form ───────────────────────────────────────────
    const referee = await as(judge);
    await visit(referee, editUrl);
    await expect(save(referee)).toHaveCount(0);
  } finally {
    for (const context of contexts) await context.close();
    await db.series.delete({ where: { id } });
    await db.adminAuditLog.deleteMany({ where: { OR: [{ actorId: { startsWith: id } }, { targetId: { startsWith: id } }] } });
    await db.user.deleteMany({ where: { id: { startsWith: id } } });
    await db.accessRole.deleteMany({ where: { id: { in: [partialRole.id, judgeRole.id] } } });
  }
});
