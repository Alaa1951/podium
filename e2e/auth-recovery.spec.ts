import crypto from "node:crypto";
import { test, expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { encode } from "next-auth/jwt";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// GETTING BACK IN — the recovery paths, end to end in a browser, against the
// LOCAL dev server and database (refused otherwise):
//   · a refused reset / invitation link offers a new code or link right there;
//   · an athlete signs up WITHOUT a password, signs in by code, sees
//     "Create a password" in Account, creates one — and codes still work;
//   · a signed-in athlete whose address is unproven verifies it from
//     My competitions (no competition linked yet), and their entry appears.
//
// Codes are real (the dev bypass must be off): the test cannot read the
// mailbox, so after the server has issued a code it re-keys that code's hash
// to one it knows — the server's own check then runs unchanged.
// Every row this file creates is removed afterwards.
// ─────────────────────────────────────────────────────────────────────────────

loadEnvConfig(process.cwd());

const RUN_ON = new Set(["chromium-390-en-dark", "chromium-1024-en-light", "webkit-390-en-light"]);
const run = `${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
const mail = (who: string) => `e2e-${who}-${run}@example.test`;
const KNOWN_CODE = "246810";

const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url.toString()) });
const createdUsers = new Set<string>();
const createdSeries = new Set<string>();

function hmac(value: string) {
  const secret = process.env.OTP_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("OTP_SECRET or NEXTAUTH_SECRET is required");
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function guard(info: TestInfo) {
  test.skip(!RUN_ON.has(info.project.name), "Recovery flows run on three representative projects.");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("LOCAL_DATABASE_ONLY");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(info.project.use.baseURL!).hostname)) throw new Error("LOCAL_SERVER_ONLY");
  if (process.env.OTP_DEV_BYPASS === "true") throw new Error("Turn OTP_DEV_BYPASS off: these flows must check real codes.");
}

let caller = 0;
async function english(context: BrowserContext, info: TestInfo) {
  await context.addCookies([{ name: "podium_locale", value: "en", url: info.project.use.baseURL! }]);
  // Each test is a different athlete on a different network, as in real use
  // (the code door throttles per network as well as per address).
  caller += 1;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.${crypto.randomInt(0, 255)}.${caller}` });
}

/** A sign-up field by its visible label (a select's accessible name also carries its current option). */
function field(page: Page, label: string) {
  return page.locator("label.signup-field").filter({ has: page.locator("span.field-label-dark", { hasText: new RegExp(`^${label}$`) }) }).locator("input, select");
}

/** After the server issued a code to this account, make it one we can type. */
async function rekeyLatestCode(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const latest = await prisma.otpChallenge.findFirstOrThrow({ where: { userId: user.id, consumedAt: null }, orderBy: { createdAt: "desc" } });
  expect(latest.sentTo).toBe(email); // issued to the address it will prove
  await prisma.otpChallenge.update({ where: { id: latest.id }, data: { codeHash: hmac(KNOWN_CODE) } });
}

async function competitor(email: string, extra: Record<string, unknown> = {}) {
  const user = await prisma.user.create({ data: { email, name: "E2E Athlete", role: "competitor", status: "active", approvalStatus: "approved", ...extra } });
  createdUsers.add(user.id);
  return user;
}

async function signedInAs(context: BrowserContext, info: TestInfo, user: { id: string; email: string; name: string | null }) {
  const origin = info.project.use.baseURL!;
  await context.addCookies([{
    name: "next-auth.session-token", url: origin,
    value: await encode({
      secret: process.env.NEXTAUTH_SECRET!,
      token: { sub: user.id, id: user.id, email: user.email, name: user.name, role: "competitor", studioId: null, status: "active", accessRoleId: null, locale: "en", expiresAt: Date.now() + 3_600_000, refreshedAt: Date.now() },
    }),
  }]);
}

async function signInWithCode(page: Page, email: string) {
  await page.goto("/athlete");
  await page.waitForLoadState("networkidle"); // type only once the form is live
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue(email);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await rekeyLatestCode(email);
  await page.getByLabel("Verification code").fill(KNOWN_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/me/, { timeout: 60_000 });
  await page.waitForURL(/\/me\?series=/, { timeout: 60_000 }); // /me lands on the athlete's competition
}

test.afterAll(async () => {
  const users = [...createdUsers];
  const series = [...createdSeries];
  await prisma.competitor.deleteMany({ where: { team: { seriesId: { in: series } } } });
  await prisma.team.deleteMany({ where: { seriesId: { in: series } } });
  await prisma.seriesParticipant.deleteMany({ where: { OR: [{ userId: { in: users } }, { seriesId: { in: series } }] } });
  await prisma.series.deleteMany({ where: { id: { in: series } } });
  for (const model of ["otpChallenge", "authToken", "loginEvent", "trustedDevice", "athleteProfile", "adminAuditLog"] as const) {
    const where = model === "adminAuditLog" ? { actorId: { in: users } } : { userId: { in: users } };
    await (prisma[model] as unknown as { deleteMany: (args: unknown) => Promise<unknown> }).deleteMany({ where }).catch(() => undefined);
  }
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

test("a reset link sent to a former address is refused on the page itself, with both ways forward", async ({ page, context }, info) => {
  guard(info);
  await english(context, info);
  const user = await competitor(mail("reset"));
  const token = `e2e-${run}-reset`;
  await prisma.authToken.create({ data: { userId: user.id, tokenHash: hmac(token), purpose: "reset", expiresAt: new Date(Date.now() + 1_800_000), sentTo: mail("former") } });

  await page.goto(`/reset-password?token=${token}`);
  await expect(page.getByText("This link can't be used any more.")).toBeVisible();
  await expect(page.getByLabel("New password")).toHaveCount(0); // no form to type a password into
  await page.getByRole("link", { name: "Send me a sign-in code" }).click();
  await expect(page).toHaveURL(/\/athlete$/, { timeout: 60_000 });
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBeNull();
});

test("an invitation from before recipients were recorded is refused on the page, and points to a fresh link", async ({ page, context }, info) => {
  guard(info);
  await english(context, info);
  const user = await competitor(mail("invite"), { status: "invited" });
  const token = `e2e-${run}-invite`;
  await prisma.authToken.create({ data: { userId: user.id, tokenHash: hmac(token), purpose: "invite", expiresAt: new Date(Date.now() + 1_800_000), sentTo: null } });

  await page.goto(`/activate?token=${token}`);
  await expect(page.getByText("This link can't be used any more.")).toBeVisible();
  await page.getByRole("link", { name: "Send me a link to set a password" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/, { timeout: 60_000 });
});

test("an athlete signs up with NO password, signs in by code, creates a password from Account — and codes still work", async ({ page, context }, info) => {
  guard(info);
  test.setTimeout(240_000);
  await english(context, info);
  const email = mail("signup");

  await page.goto("/signup?type=athlete");
  // Type only once the form is live: text typed before hydration is reset by it.
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Password (optional)")).toBeVisible();
  await field(page, "Full name").fill("E2E Code Only");
  await field(page, "Email").fill(email);
  await field(page, "Phone").fill("+97455500000");
  // A date input is typed differently by each engine; set it as the page would.
  await field(page, "Date of birth").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "1994-05-06");
  await field(page, "Gender").selectOption("f");
  await field(page, "Level").selectOption("Open");
  await field(page, "Category").selectOption("Womens");
  await field(page, "T-shirt size").selectOption({ index: 1 });
  await page.getByRole("button", { name: "No — looking for a partner" }).click();
  await expect(field(page, "Full name")).toHaveValue("E2E Code Only");
  await expect(field(page, "Date of birth")).toHaveValue("1994-05-06");
  await page.getByRole("button", { name: "Send me a code" }).click();

  const codeInput = page.locator('input[autocomplete="one-time-code"]');
  await expect(codeInput).toBeVisible();
  const created = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUsers.add(created.id);
  expect(created.passwordHash).toBeNull(); // no password was set
  await rekeyLatestCode(email);
  await codeInput.fill(KNOWN_CODE);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/me/, { timeout: 60_000 });
  await page.waitForURL(/\/me\?series=/, { timeout: 60_000 }); // /me lands on the athlete's competition

  // Account: a code-only athlete is offered to CREATE a password, told the truth about devices.
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Create a password" })).toBeVisible();
  await expect(page.getByText("Codes keep working either way.", { exact: false })).toBeVisible();
  await expect(page.getByText("Devices already signed in stay signed in.", { exact: false })).toBeVisible();
  await expect(page.getByText("signs every device out")).toHaveCount(0);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByText("A link is on its way", { exact: false })).toBeVisible({ timeout: 60_000 });
  const issued = await prisma.authToken.findFirstOrThrow({ where: { userId: created.id, purpose: "reset", usedAt: null }, orderBy: { createdAt: "desc" } });
  expect(issued.sentTo).toBe(email);

  // The emailed link, opened: "Create a password", then one is set.
  const token = `e2e-${run}-create`;
  await prisma.authToken.update({ where: { id: issued.id }, data: { tokenHash: hmac(token) } });
  await page.goto(`/reset-password?token=${token}`);
  await expect(page.getByText("Create a password").first()).toBeVisible();
  await page.waitForLoadState("networkidle"); // type only once the form is live
  await page.getByLabel("New password").fill("Podium2026x");
  await page.getByLabel("Confirm password").fill("Podium2026x");
  await expect(page.getByLabel("New password")).toHaveValue("Podium2026x");
  await page.getByRole("button", { name: "Set your password" }).click();
  await expect(page.getByText("Password set. You can sign in now.")).toBeVisible();
  expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).passwordHash).not.toBeNull();

  // …and the code door still works for the same account.
  await context.clearCookies();
  await english(context, info);
  await signInWithCode(page, email);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
});

test("a signed-in athlete with an unproven address verifies it from My competitions, and the entry appears", async ({ page, context }, info) => {
  guard(info);
  await english(context, info);
  const email = mail("verify");
  const user = await competitor(email, { verifiedEmail: null });
  const series = await prisma.series.create({ data: { name: `E2E Recovery ${run}`, slug: `e2e-recovery-${run}-${info.project.name}`, competitionDate: new Date(Date.now() + 7 * 86_400_000), status: "scheduled" } });
  createdSeries.add(series.id);
  await prisma.team.create({
    data: {
      seriesId: series.id, number: 1, name: "E2E PAIR", category: "Womens", division: "Open", paymentStatus: "paid",
      competitors: { create: [{ position: 1, fullName: "E2E Athlete", normalizedName: "e2e athlete", email }, { position: 2, fullName: "E2E Partner", normalizedName: "e2e partner", email: mail("partner") }] },
    },
  });
  await signedInAs(context, info, user);

  await page.goto("/me?series=all");
  await expect(page.getByText("No entry found for you yet.")).toBeVisible();
  await expect(page.getByText("Verify your email")).toBeVisible();
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByLabel("Verification code")).toBeVisible();
  await rekeyLatestCode(email);
  await page.getByLabel("Verification code").fill(KNOWN_CODE);
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByText(`E2E Recovery ${run}`)).toBeVisible();
  await expect(page.getByText("Verify your email")).toHaveCount(0);
  const seat = await prisma.competitor.findFirstOrThrow({ where: { email, team: { seriesId: series.id } } });
  expect(seat.userId).toBe(user.id);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).verifiedEmail).toBe(email);
});
