/**
 * A NEW JUDGE SIGNS UP AND TYPES THE CODE — in a real browser.
 *
 * The code screen must tell the three failures a person meets apart (a
 * replaced code, a wrong code, and waiting to ask again), and the right code
 * must sign them in. The address is on the reserved .invalid domain and the
 * local server only logs mail, so nothing is ever sent. The code itself is
 * set on the stored challenge (the test knows the local secret), since the
 * email is never read.
 */
import { test, expect } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { createTranslator } from "../src/lib/i18n/dictionary";

loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Sign-up fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });
const hash = (code: string) => createHmac("sha256", (process.env.OTP_SECRET || process.env.NEXTAUTH_SECRET)!).update(code).digest("hex");

test("a new Judge signs up, meets a replaced and a wrong code, and signs in with the right one", async ({ page }, info) => {
  test.setTimeout(240_000);
  const origin = info.project.use.baseURL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Local server only");
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const t = createTranslator(locale);
  const email = `judge-${randomUUID().slice(0, 8)}@sched-qa.invalid`;
  await page.context().addCookies([{ name: "podium_locale", value: locale, url: origin }]);
  await mkdir(".mobile-qa/signup", { recursive: true });
  const capture = (name: string) => page.screenshot({ path: `.mobile-qa/signup/${info.project.name}-${name}.png`, fullPage: true });

  try {
    await page.goto("/signup");
    await page.waitForLoadState("networkidle");
    await page.locator(".signup-choice:not(.signup-choice-sm)", { hasText: t("Organiser") }).click();
    await page.locator(".signup-choice-sm", { hasText: t("Judge") }).click();
    await page.getByRole("button", { name: t("Continue"), exact: true }).click();
    await page.getByLabel(t("Full name")).fill("New Judge");
    await page.getByLabel(t("Email")).fill(email);
    await page.getByLabel(t("Phone")).fill("+97455512345");
    // Its label also carries the password rules, so the field itself.
    await page.locator("input[type=password]").fill("Judge-Pass-2026");
    await page.getByRole("button", { name: t("Send me a code"), exact: true }).click();

    await expect(page.getByRole("heading", { name: t("Check your email") })).toBeVisible();
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ role: "organiser", status: "invited", requestedRoleKey: "judge" });
    // A code just went out: "send again" waits, and shows for how long.
    await expect(page.getByTestId("signup-resend")).toBeDisabled();
    await expect(page.getByTestId("signup-resend")).toContainText("(");

    // The code in the newest email is 246810; an earlier email carried 135790.
    const current = await db.otpChallenge.findFirstOrThrow({ where: { userId: user.id, consumedAt: null } });
    await db.otpChallenge.update({ where: { id: current.id }, data: { codeHash: hash("246810") } });
    await db.otpChallenge.create({ data: {
      userId: user.id, purpose: "login", codeHash: hash("135790"), sentTo: email,
      createdAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() + 480_000), consumedAt: new Date(Date.now() - 60_000),
    } });

    const code = page.getByLabel(t("Verification code"));
    const confirm = page.getByRole("button", { name: t("Confirm"), exact: true });
    await code.fill("135790");
    await confirm.click();
    await expect(page.locator(".notice-error[role=alert]")).toHaveText(t("A newer code was sent after this one. Use the code from the most recent email."));
    await capture("code-replaced");
    await code.fill("111111");
    await confirm.click();
    await expect(page.locator(".notice-error[role=alert]")).toHaveText(t("That code is not correct. Check the most recent email we sent, or ask for a new code."));
    // Typing the replaced code cost the newest code nothing; the wrong one cost one try.
    expect((await db.otpChallenge.findUniqueOrThrow({ where: { id: current.id } })).attempts).toBe(1);

    await code.fill("246810");
    await confirm.click();
    await expect(page).not.toHaveURL(/\/signup/, { timeout: 30_000 });
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ status: "active", verifiedEmail: email, approvalStatus: "pending" });
  } finally {
    const account = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (account) {
      await db.otpChallenge.deleteMany({ where: { userId: account.id } });
      await db.loginEvent.deleteMany({ where: { userId: account.id } });
      await db.user.delete({ where: { id: account.id } });
    }
  }
});
