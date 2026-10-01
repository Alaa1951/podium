/**
 * THE PAYER'S DOOR, in a real browser: a signed-in payer whose address the
 * CRM put on BOTH seats of their team sees their team — not "No entry found".
 * An athlete whose address sits on seats of two teams sees why nothing links.
 *
 * Each person signs in with a proven address; /me links on the visit
 * (link-seats.ts). Then the database is read.
 */
import { test, expect } from "@playwright/test";
import { visit } from "./support/visit";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { createTranslator } from "../src/lib/i18n/dictionary";

loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Payer fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

test("the payer sees their team; an address shared by two teams is told why it does not", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const suffix = randomUUID().slice(0, 8);
  const id = `pay-qa-${suffix}`;
  const origin = info.project.use.baseURL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Local fixture sessions only");
  const payerEmail = `payer-${suffix}@pay-qa.invalid`;
  const coachEmail = `coach-${suffix}@pay-qa.invalid`;

  await db.series.create({ data: { id, slug: id, name: `Pay QA ${suffix}`, status: "scheduled", competitionDate: new Date(Date.now() + 10 * 86_400_000) } });
  const team = (key: string, number: number, seats: [number, string | null][]) => db.team.create({ data: {
    id: `${id}-${key}`, seriesId: id, number, name: `${key.toUpperCase()} ${suffix}`, category: "Womens", division: "Open", paymentStatus: "paid",
    competitors: { create: seats.map(([position, email]) => ({ id: `${id}-${key}-${position}`, position, fullName: `${key} athlete ${position}`, normalizedName: `${key} athlete ${position}`, email })) },
  } });
  // The CRM put the payer's address on the partner's seat too.
  await team("falcons", 1, [[1, payerEmail], [2, payerEmail]]);
  // A coach's address on two teams of the same competition.
  await team("hawks", 2, [[1, coachEmail], [2, null]]);
  await team("owls", 3, [[1, `owl-${suffix}@pay-qa.invalid`], [2, coachEmail]]);

  const person = (key: string, email: string) => db.user.create({ data: {
    id: `${id}-${key}`, email, name: `Pay ${key}`, role: "competitor", status: "active", approvalStatus: "pending", verifiedEmail: email,
  } });
  const payer = await person("payer", payerEmail);
  const coach = await person("coach", coachEmail);
  // The coach signed up for this competition, so it is theirs to open.
  await db.seriesParticipant.create({ data: { seriesId: id, userId: coach.id, category: "Womens", division: "Open", lookingForPartner: true } });

  const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  const as = async (user: { id: string; email: string; name: string | null }) => {
    const context = await browser.newContext({ ...info.project.use, baseURL: origin });
    contexts.push(context);
    await context.addCookies([
      { name: "podium_locale", value: locale, url: origin },
      { name: "next-auth.session-token", url: origin, value: await encode({ secret: process.env.NEXTAUTH_SECRET!,
        token: { sub: user.id, id: user.id, email: user.email, name: user.name, role: "competitor", studioId: null, status: "active", locale, expiresAt: Date.now() + 3_600_000, refreshedAt: Date.now() } }) },
    ]);
    return context.newPage();
  };
  await mkdir(".mobile-qa/payer", { recursive: true });
  const seat = (key: string) => db.competitor.findUniqueOrThrow({ where: { id: `${id}-${key}` } });

  try {
    // ── The payer: their team, and only their own seat ─────────────────────
    const payerPage = await as(payer);
    await visit(payerPage, "/me");
    await expect(payerPage.locator("body")).toContainText(`FALCONS ${suffix}`);
    await expect(payerPage.getByText(t("No entry found for you yet."))).toHaveCount(0);
    expect(await seat("falcons-1")).toMatchObject({ userId: payer.id });
    expect(await seat("falcons-2")).toMatchObject({ userId: null });
    expect(await db.user.findUniqueOrThrow({ where: { id: payer.id } })).toMatchObject({ approvalStatus: "approved" });
    await payerPage.screenshot({ path: `.mobile-qa/payer/${info.project.name}-payer.png` });

    // ── The coach: nothing linked, and the screen says why ─────────────────
    const coachPage = await as(coach);
    await visit(coachPage, `/me?series=${id}`);
    await expect(coachPage.getByText(t("No entry found for you yet."))).toBeVisible();
    await expect(coachPage.getByTestId("shared-across-teams")).toHaveText(
      t("Your email is on a registration in this competition, but more than one team uses it. Each team needs its registrant's own email — contact BFT MENA.")
    );
    expect(await seat("hawks-1")).toMatchObject({ userId: null });
    expect(await seat("owls-2")).toMatchObject({ userId: null });
    await coachPage.screenshot({ path: `.mobile-qa/payer/${info.project.name}-shared.png` });
  } finally {
    for (const context of contexts) await context.close();
    await db.series.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { startsWith: id } } });
  }
});
