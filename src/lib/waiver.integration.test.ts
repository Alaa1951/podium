/**
 * WAIVER DECLARATIONS AGAINST A REAL DATABASE — attaching a version, the
 * athlete signing it, what the record holds, and every way a signature is
 * refused. The actions themselves, the app's Prisma client on a throwaway
 * schema (see schedule-auto.integration.test.ts for the arrangement).
 *
 *   INTEGRATION_DB=1 npx vitest run src/lib/waiver.integration.test.ts
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
  url.pathname = `/pudem_wvr_${Math.random().toString(36).slice(2, 12)}`;
  process.env.DATABASE_URL = url.toString();
  return { on, base, schemaUrl: url.toString(), actor: { current: null as unknown } };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: () => undefined }));
vi.mock("@/lib/session", async () => {
  const access = await vi.importActual<typeof import("@/lib/access")>("@/lib/access");
  return { ...access, getCurrentUser: async () => env.actor.current };
});

import { prisma } from "@/lib/prisma";
import { attachWaiver, signMyWaiver } from "@/lib/actions/waivers";
import { actors, createSchema, seed } from "@/lib/schedule-integration-fixture";
import { editionContent, SIGNING_TEXT, WAIVER_DOCUMENTS } from "@/lib/waivers/document";
import { loadReceipt, sha256, seatsOf, waiverStates } from "@/lib/waivers/waiver-db";
import { activeReleaseId, athleteOf, attach, linkAccounts, newVersion } from "@/lib/waiver-integration-fixture";

const as = (actor: unknown) => { env.actor.current = actor; };
const seatOf = (number: number, position = 1) => prisma.competitor.findFirstOrThrow({ where: { team: { seriesId: "s1", number }, position } });
async function stateOf(number: number, position = 1) {
  const seat = await seatOf(number, position);
  return (await waiverStates(prisma, "s1", await seatsOf(prisma, [seat.teamId]))).get(seat.id);
}
async function sign(number: number, over: Record<string, unknown> = {}, position = 1) {
  const seat = await seatOf(number, position);
  as(athleteOf(seat.id));
  return signMyWaiver({ seriesId: "s1", releaseId: await activeReleaseId(prisma), language: "en", typedName: seat.fullName, agreed: true, ...over });
}

describe.skipIf(!env.on)("waiver declarations on a real database", { timeout: 90_000 }, () => {
  let drop: (() => Promise<void>) | undefined;
  beforeAll(async () => { drop = await createSchema(env.base, env.schemaUrl); }, 180_000);
  afterAll(async () => { await prisma.$disconnect(); await drop?.(); });
  beforeEach(async () => {
    await seed(prisma);
    await linkAccounts(prisma, [1, 2, 11, 21]);
  });

  it("attaching stores both editions exactly as bundled, with their SHA-256 — and only for this competition", async () => {
    as(actors.hq);
    expect(await attachWaiver({ seriesId: "s1", documentKey: "podium-series-1", version: 1 })).toEqual({ ok: true, version: 1 });
    const editions = await prisma.waiverEdition.findMany({ orderBy: { language: "asc" } });
    const doc = WAIVER_DOCUMENTS[0];
    expect(editions.map((one) => one.language)).toEqual(["en", "ar"]);
    for (const edition of editions) {
      expect(edition.content).toBe(editionContent(doc.editions[edition.language]));
      expect(edition.contentHash).toBe(sha256(edition.content));
      expect(edition.acknowledgement).toBe(SIGNING_TEXT[edition.language].acknowledgement);
    }
    // The approved contact correction, and nothing of the old address.
    expect(editions.every((one) => one.content.includes("info@bftmiddleeast.com") && !one.content.includes("westwalk@"))).toBe(true);
    // Nobody is signed by attaching: every athlete starts pending.
    expect(await prisma.waiverAcceptance.count()).toBe(0);
    expect(await stateOf(1)).toBe("pending");
    // Staff without `waivers.manage` cannot attach, and a repeat changes nothing.
    as(actors.organiser);
    expect(await attachWaiver({ seriesId: "s1", documentKey: "podium-series-1", version: 1 })).toEqual({ ok: false, error: "FORBIDDEN" });
    as(actors.hq);
    expect(await attachWaiver({ seriesId: "s1", documentKey: "podium-series-1", version: 1 })).toEqual({ ok: false, error: "ALREADY_ACTIVE" });
  });

  it("an athlete signs for themselves: the record holds who, what, which version and language, the exact sentence, and the category", async () => {
    await attach(prisma);
    const seat = await seatOf(21);
    const result = await sign(21, { language: "ar", typedName: "  سارة   أحمد " });
    expect(result).toMatchObject({ ok: true, already: false });
    const record = await prisma.waiverAcceptance.findFirstOrThrow();
    expect(record).toMatchObject({
      userId: athleteOf(seat.id).id, seriesId: "s1", teamId: seat.teamId, competitorId: seat.id, typedName: "سارة أحمد",
      language: "ar", acknowledgement: SIGNING_TEXT.ar.acknowledgement, category: "Womens", division: "Rookie",
      signatureMethod: "typed_name",
    });
    const edition = await prisma.waiverEdition.findUniqueOrThrow({ where: { id: record.editionId } });
    expect(record.contentHash).toBe(edition.contentHash);
    expect(await stateOf(21)).toBe("signed");
    // A partner is never covered by it.
    expect(await stateOf(21, 2)).toBe("pending");
    // The audit line says what was signed — never the signature.
    const line = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "registration.waiver_signed" } });
    expect(line.detail).toBe("waiver version 1 signed (Arabic edition)");
    expect(line.detail).not.toContain("سارة");
  });

  it("the same signature twice — one after another or at the same instant — is one record", async () => {
    await attach(prisma);
    const first = await sign(1);
    const again = await sign(1);
    expect(again).toEqual({ ok: true, acceptanceId: (first as { acceptanceId: string }).acceptanceId, already: true });
    const [a, b] = await Promise.all([sign(2), sign(2)]);
    expect([a, b].every((one) => one.ok)).toBe(true);
    expect(await prisma.waiverAcceptance.count()).toBe(2);
  });

  it("the server refuses a missing tick, a blank or letterless name, a stale version, a view-as, and anybody without a seat", async () => {
    await attach(prisma);
    expect(await sign(1, { agreed: false })).toEqual({ ok: false, error: "ACKNOWLEDGEMENT_REQUIRED" });
    expect(await sign(1, { typedName: "   " })).toEqual({ ok: false, error: "NAME_REQUIRED" });
    expect(await sign(1, { typedName: "123 !!" })).toEqual({ ok: false, error: "NAME_REQUIRED" });
    expect(await sign(1, { releaseId: "an-old-release" })).toEqual({ ok: false, error: "STALE_VERSION", currentVersion: 1 });
    const seat = await seatOf(1);
    as({ ...athleteOf(seat.id), viewAs: { role: "competitor" } });
    expect(await signMyWaiver({ seriesId: "s1", releaseId: await activeReleaseId(prisma), language: "en", typedName: "X", agreed: true })).toEqual({ ok: false, error: "FORBIDDEN" });
    // Staff hold no seat: there is nobody for them to sign as — and no field to name another athlete.
    as(actors.organiser);
    expect(await signMyWaiver({ seriesId: "s1", releaseId: await activeReleaseId(prisma), language: "en", typedName: "Organiser", agreed: true, competitorId: seat.id, userId: athleteOf(seat.id).id }))
      .toEqual({ ok: false, error: "NOT_REGISTERED" });
    expect(await prisma.waiverAcceptance.count()).toBe(0);
  });

  it("a new version keeps every earlier signature, and asks everybody to sign again", async () => {
    await attach(prisma);
    await sign(1);
    const old = await activeReleaseId(prisma);
    await newVersion(prisma);
    expect(await stateOf(1)).toBe("resign");
    expect(await sign(1, { releaseId: old })).toEqual({ ok: false, error: "STALE_VERSION", currentVersion: 2 });
    expect(await sign(1)).toMatchObject({ ok: true, already: false });
    expect(await stateOf(1)).toBe("signed");
    expect(await prisma.waiverAcceptance.count({ where: { competitorId: (await seatOf(1)).id } })).toBe(2);
  });

  it("a category or level change never asks for a new signature — the record keeps what it was signed as", async () => {
    await attach(prisma);
    await sign(1); // Mens Rookie
    await prisma.team.update({ where: { id: "t1" }, data: { category: "Mixed", division: "Open" } });
    expect(await stateOf(1)).toBe("signed");
    await prisma.team.update({ where: { id: "t1" }, data: { category: "Womens", division: "Pro" } });
    expect(await stateOf(1)).toBe("signed");
    expect(await sign(1)).toMatchObject({ ok: true, already: true });
    expect(await prisma.waiverAcceptance.findFirstOrThrow()).toMatchObject({ category: "Mens", division: "Rookie" });
  });

  it("somebody new on a seat is not covered by the signature of the person they replaced", async () => {
    await attach(prisma);
    await sign(11);
    const seat = await seatOf(11);
    await prisma.user.create({ data: { id: "acct-new", email: "new@example.com", name: "Newcomer", role: "competitor", status: "active" } });
    await prisma.competitor.update({ where: { id: seat.id }, data: { userId: "acct-new", fullName: "Newcomer" } });
    expect(await stateOf(11)).toBe("pending");
  });

  it("a receipt is the athlete's own — or BFT MENA's to read — and proves its content is intact", async () => {
    await attach(prisma);
    const { acceptanceId } = (await sign(1)) as { acceptanceId: string };
    const owner = athleteOf((await seatOf(1)).id);
    expect(await loadReceipt(prisma, acceptanceId, { id: owner.id, mayReadAll: false })).toMatchObject({ typedName: expect.any(String), contentIntact: true });
    expect(await loadReceipt(prisma, acceptanceId, { id: athleteOf((await seatOf(2)).id).id, mayReadAll: false })).toBeNull();
    expect(await loadReceipt(prisma, acceptanceId, { id: actors.hq.id, mayReadAll: true })).not.toBeNull();
  });

  it("a staff account that also competes signs its own, like anybody else", async () => {
    await attach(prisma);
    await prisma.competitor.update({ where: { id: (await seatOf(8)).id }, data: { userId: actors.organiser.id } });
    expect(await stateOf(8)).toBe("pending");
    as(actors.organiser);
    expect(await signMyWaiver({ seriesId: "s1", releaseId: await activeReleaseId(prisma), language: "en", typedName: "Org Anizer", agreed: true })).toMatchObject({ ok: true });
    expect(await stateOf(8)).toBe("signed");
  });
});
