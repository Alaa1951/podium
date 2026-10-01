/**
 * THE PAYER'S DOOR ON A REAL DATABASE — which seat an address claims when it
 * signs in, and whether the code door opens for it (link-seats.ts ›
 * payerSeatsToClaim, competitor-access.ts). The real queries, the real locks,
 * the app's Prisma client on a throwaway schema (see
 * schedule-auto.integration.test.ts for the arrangement).
 *
 *   INTEGRATION_DB=1 npx vitest run src/lib/payer-door.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const on = process.env.INTEGRATION_DB === "1";
  if (on) {
    try { process.loadEnvFile(".env"); } catch { /* DATABASE_URL must already be set */ }
  }
  process.env.NEXTAUTH_SECRET ||= "integration-test-secret";
  const base = process.env.DATABASE_URL ?? "mysql://skipped@127.0.0.1:1/skipped";
  const url = new URL(base);
  url.pathname = `/pudem_pay_${Math.random().toString(36).slice(2, 12)}`;
  process.env.DATABASE_URL = url.toString();
  return { on, base, schemaUrl: url.toString() };
});

import { prisma } from "@/lib/prisma";
import { issueCompetitorCode } from "@/lib/competitor-access";
import { linkSeatsForUser } from "@/lib/link-seats";
import { createSchema } from "@/lib/schedule-integration-fixture";

const seat = (id: string) => prisma.competitor.findUniqueOrThrow({ where: { id } });

/** A competing team (paid, holding a place) with the given seats: [id, position, email]. */
async function teamOf(id: string, seriesId: string, seats: [string, number, string | null][], extra: Record<string, unknown> = {}) {
  await prisma.team.create({ data: {
    id, seriesId, number: Math.floor(Math.random() * 100000), name: id.toUpperCase(), category: "Womens", division: "Open", paymentStatus: "paid", ...extra,
    competitors: { create: seats.map(([seatId, position, email]) => ({ id: seatId, position, fullName: `Athlete ${seatId}`, normalizedName: `athlete ${seatId}`, email })) },
  } });
}
const athlete = (id: string, email: string) =>
  prisma.user.create({ data: { id, email, name: id, role: "competitor", status: "active", approvalStatus: "pending", verifiedEmail: email } });

describe.skipIf(!env.on)("the payer's door on a real database", { timeout: 90_000 }, () => {
  let drop: (() => Promise<void>) | undefined;
  beforeAll(async () => { drop = await createSchema(env.base, env.schemaUrl); }, 180_000);
  afterAll(async () => { await prisma.$disconnect(); await drop?.(); });
  beforeEach(async () => {
    delete process.env.ATHLETE_SEAT_LINKING;
    await prisma.otpChallenge.deleteMany();
    await prisma.seriesParticipant.deleteMany();
    await prisma.competitor.deleteMany();
    await prisma.team.deleteMany();
    await prisma.series.deleteMany();
    await prisma.user.deleteMany();
    await prisma.series.create({ data: { id: "s1", name: "Series", slug: "series", status: "scheduled", competitionDate: new Date(Date.now() + 10 * 86_400_000) } });
  });

  it("the payer's address on both seats of their team claims the registrant's seat, approves them, and shows them their team", async () => {
    await teamOf("t1", "s1", [["payer", 1, "sara@example.com"], ["partner", 2, "sara@example.com"]]);
    await athlete("u-sara", "sara@example.com");
    expect(await linkSeatsForUser(prisma, "u-sara")).toEqual({ linked: 1, approved: true, skipped: null });
    expect(await seat("payer")).toMatchObject({ userId: "u-sara" });
    expect(await seat("partner")).toMatchObject({ userId: null, email: "sara@example.com" });
    expect(await prisma.team.findFirst({ where: { seriesId: "s1", competitors: { some: { userId: "u-sara" } } }, select: { id: true } })).toEqual({ id: "t1" });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: "u-sara" } })).toMatchObject({ approvalStatus: "approved" });
    // Again: nothing more to claim; the partner's seat is left for its own address.
    expect(await linkSeatsForUser(prisma, "u-sara")).toEqual({ linked: 0, approved: false, skipped: null });
    expect(await seat("partner")).toMatchObject({ userId: null });
  });

  it("an address on seats of two teams in one competition claims nothing — seat 1 and seat 1, or seat 1 and seat 2", async () => {
    await teamOf("tA", "s1", [["a1", 1, "coach@example.com"], ["a2", 2, "x@example.com"]]);
    await teamOf("tB", "s1", [["b1", 1, "y@example.com"], ["b2", 2, "coach@example.com"]]);
    await teamOf("tC", "s1", [["c1", 1, "coach@example.com"], ["c2", 2, null]]);
    await athlete("u-coach", "coach@example.com");
    expect(await linkSeatsForUser(prisma, "u-coach")).toEqual({ linked: 0, approved: false, skipped: null });
    for (const id of ["a1", "b2", "c1"]) expect(await seat(id)).toMatchObject({ userId: null });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: "u-coach" } })).toMatchObject({ approvalStatus: "pending" });
  });

  it("a partner seat with no email never counts: the payer claims their seat", async () => {
    await teamOf("t1", "s1", [["payer", 1, "sara@example.com"], ["partner", 2, null]]);
    await athlete("u-sara", "sara@example.com");
    expect(await linkSeatsForUser(prisma, "u-sara")).toMatchObject({ linked: 1, approved: true });
    expect(await seat("payer")).toMatchObject({ userId: "u-sara" });
  });

  it("an unpaid or waiting-list team: the payer's seat is linked and shown, nobody is approved", async () => {
    await teamOf("t1", "s1", [["payer", 1, "sara@example.com"], ["partner", 2, "sara@example.com"]], { paymentStatus: "pending" });
    await athlete("u-sara", "sara@example.com");
    expect(await linkSeatsForUser(prisma, "u-sara")).toEqual({ linked: 1, approved: false, skipped: null });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: "u-sara" } })).toMatchObject({ approvalStatus: "pending" });
  });

  it("switched off, nothing links", async () => {
    process.env.ATHLETE_SEAT_LINKING = "off";
    await teamOf("t1", "s1", [["payer", 1, "sara@example.com"], ["partner", 2, "sara@example.com"]]);
    await athlete("u-sara", "sara@example.com");
    expect(await linkSeatsForUser(prisma, "u-sara")).toEqual({ linked: 0, approved: false, skipped: null });
    expect(await seat("payer")).toMatchObject({ userId: null });
  });

  it("the code door opens for a payer with no account yet — and stays shut for an address spanning teams", async () => {
    await teamOf("t1", "s1", [["payer", 1, "sara@example.com"], ["partner", 2, "sara@example.com"]]);
    const issued = await issueCompetitorCode("Sara@Example.com");
    expect(issued).toMatchObject({ ok: true, name: "Athlete payer" });
    // Minted as invited, nothing proven, nothing linked until the code is typed.
    expect(await prisma.user.findUniqueOrThrow({ where: { email: "sara@example.com" } })).toMatchObject({ role: "competitor", status: "invited", verifiedEmail: null });
    expect(await seat("payer")).toMatchObject({ userId: null });

    await teamOf("tA", "s1", [["a1", 1, "coach@example.com"], ["a2", 2, null]]);
    await teamOf("tB", "s1", [["b1", 1, "coach@example.com"], ["b2", 2, null]]);
    expect(await issueCompetitorCode("coach@example.com")).toEqual({ ok: false, signup: true });
    expect(await prisma.user.count({ where: { email: "coach@example.com" } })).toBe(0);
  });
});
