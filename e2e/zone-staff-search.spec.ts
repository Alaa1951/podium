import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { encode } from "next-auth/jwt";
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { visit } from "./support/visit";

loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Assignment fixtures require a local database");
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
test.afterAll(async () => { await db.$disconnect(); });

test("search a long zone assignment list and save each position", async ({ page, context }, info) => {
  const id = `staff-search-${randomUUID().slice(0, 8)}`;
  const locale = info.project.name.includes("-ar-") ? "ar" : "en";
  const origin = info.project.use.baseURL!;
  const judgeRole = await db.accessRole.findUniqueOrThrow({ where: { key: "judge" } });
  const admin = await db.user.create({ data: {
    id: `${id}-admin`, name: "Assignment QA", email: `${id}-admin@staff-qa.invalid`,
    role: "admin", status: "active", approvalStatus: "approved",
  } });
  const people = [
    { name: `${id} Ahmed Ali`, email: `${id}-ahmed@staff-qa.invalid` },
    { name: `${id} أحمد إبراهيم`, email: `${id}-arabic@staff-qa.invalid` },
    { name: `${id} Reserve with a very long name to check wrapping on narrow phones`, email: `${id}-reserve@staff-qa.invalid` },
    ...Array.from({ length: 35 }, (_, index) => ({ name: `Search fixture ${index}`, email: `${id}-${index}@staff-qa.invalid` })),
  ];

  try {
    await db.series.create({ data: {
      id, slug: id, name: "Assignment search QA", status: "scheduled", isTraining: true,
      competitionDate: new Date(), waveCapacity: 3,
      zones: { create: [1, 2].map((number) => ({ id: `${id}-z${number}`, number, name: `Zone ${number}` })) },
    } });
    for (const [index, person] of people.entries()) {
      await db.user.create({ data: {
        ...person, id: `${id}-p${index}`, role: "organiser", status: "active", approvalStatus: "approved",
        accessRoles: { create: { accessRoleId: judgeRole.id } },
      } });
    }
    await context.addCookies([
      { name: "podium_locale", value: locale, url: origin },
      { name: "podium_theme", value: info.project.name.endsWith("light") ? "light" : "dark", url: origin },
      { name: "next-auth.session-token", url: origin, value: await encode({ secret: process.env.NEXTAUTH_SECRET!,
        token: { sub: admin.id, id: admin.id, email: admin.email, name: admin.name, role: "admin", studioId: null,
          status: "active", locale, expiresAt: Date.now() + 3_600_000, refreshedAt: Date.now() } }) },
    ]);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await visit(page, `/series/${id}/wave-control`);
    const zones = page.locator(".zone-staff-grid > .card");
    const zone = zones.first();
    const input = zone.getByRole("combobox").first();
    const add = zone.getByRole("button", { name: locale === "ar" ? "إضافة" : "Add", exact: true });

    await input.fill(`  ${id} ALI ahmed  `);
    await expect(zone.getByRole("option")).toHaveCount(1);
    await expect(zone.getByRole("option")).toContainText("Ahmed Ali");
    await expect(add).toBeDisabled();
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(input).toHaveValue(/Ahmed Ali/);
    await expect(add).toBeEnabled();
    // Editing a chosen name must clear its ID rather than assign a stale person.
    await input.fill("NobodyMatchesThisSearch");
    await expect(zone.getByRole("option")).toHaveCount(0);
    await expect(zone.getByRole("status")).toContainText(locale === "ar" ? "لا توجد نتائج" : "No matching people");
    await expect(add).toBeDisabled();
    await input.press("Escape");
    await expect(input).toHaveValue("");

    for (const [index, position] of ["judge", "leader", "reserve"].entries()) {
      await input.fill(index === 0 ? `${id} ali ahmed` : index === 1 ? `${id} احمد ابراهيم` : people[index].email);
      await expect(zone.getByRole("option")).toHaveCount(1);
      await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      if (index === 2) {
        await mkdir(".mobile-qa/staff-search", { recursive: true });
        await zone.screenshot({ path: `.mobile-qa/staff-search/${info.project.name}-results.png` });
      }
      await zone.getByRole("option").click();
      await zone.locator(".zone-staff-assignment select").selectOption(position);
      await add.click();
      await expect.poll(async () => (await db.zoneStaff.findUnique({ where: {
        zoneId_userId: { zoneId: `${id}-z1`, userId: `${id}-p${index}` },
      } }))?.position).toBe(position);
      await expect(zone.locator(".perm-row").filter({ hasText: people[index].name })).toBeVisible();
      await expect(input).toHaveValue("");
      await expect(add).toBeDisabled();
      await input.fill(people[index].email);
      await expect(zone.getByRole("option")).toHaveCount(0);
      await input.press("Escape");
    }
    // Searches belong to their zone; a person on zone 1 remains available on zone 2.
    const otherInput = zones.nth(1).getByRole("combobox").first();
    await otherInput.fill(people[0].email);
    await expect(zones.nth(1).getByRole("option")).toHaveCount(1);
    await expect(input).toHaveValue("");
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await db.adminAuditLog.deleteMany({ where: { actorId: admin.id } });
    await db.series.deleteMany({ where: { id } });
    await db.user.deleteMany({ where: { id: { startsWith: id } } });
  }
});
