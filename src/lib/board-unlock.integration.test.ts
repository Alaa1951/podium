/**
 * THE BOARD AND A SCORE UNLOCKED FOR CORRECTION — against a real database,
 * through the actions themselves (the arrangement is schedule-auto.integration's).
 *
 * A team is on the board from its first submitted zone. Unlocking its score
 * keeps it there, with its values as they stand; the saved correction re-ranks
 * it at once. A zone never submitted never shows, draft or not.
 *
 *   INTEGRATION_DB=1 npx vitest run src/lib/board-unlock.integration.test.ts
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
  url.pathname = `/pudem_bul_${Math.random().toString(36).slice(2, 12)}`;
  process.env.DATABASE_URL = url.toString();
  return { on, base, schemaUrl: url.toString(), actor: { current: null as unknown } };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: () => undefined }));
vi.mock("@/lib/session", async () => {
  const access = await vi.importActual<typeof import("@/lib/access")>("@/lib/access");
  return { ...access, getCurrentUser: async () => env.actor.current, requireUser: async () => env.actor.current };
});

import { prisma } from "@/lib/prisma";
import { saveScore, unlockScore } from "@/lib/actions/scores";
import { buildBoardPayload } from "@/lib/board";
import { actors, createSchema, seed } from "@/lib/schedule-integration-fixture";

const as = (actor: unknown) => { env.actor.current = actor; };
const onBoard = async (teamId: string) => (await buildBoardPayload("s1"))!.teams.find((team) => team.id === teamId)!;

describe.skipIf(!env.on)("the board and a score unlocked for correction", { timeout: 90_000 }, () => {
  let drop: (() => Promise<void>) | undefined;
  beforeAll(async () => { drop = await createSchema(env.base, env.schemaUrl); }, 180_000);
  afterAll(async () => { await prisma.$disconnect(); await drop?.(); });

  let inputs: string[] = [];
  beforeEach(async () => {
    await seed(prisma);
    await prisma.series.update({ where: { id: "s1" }, data: { status: "live" } });
    await prisma.team.updateMany({ where: { id: { in: ["t1", "t2"] } }, data: { paymentStatus: "paid" } });
    const zones = await prisma.zone.findMany({ where: { seriesId: "s1" }, orderBy: { number: "asc" } });
    inputs = [];
    for (const zone of zones) {
      inputs.push((await prisma.zoneInput.create({ data: { zoneId: zone.id, position: 1, label: `Movement ${zone.number}` } })).id);
    }
    // TEAM 1: 100 in every zone, all four submitted. TEAM 2: a draft of 900 in
    // Zone 1, never submitted.
    await prisma.score.create({ data: {
      teamId: "t1", status: "submitted", submittedAt: new Date(),
      entries: { create: inputs.map((inputId) => ({ inputId, value: 100 })) },
      zones: { create: zones.map((zone) => ({ zoneId: zone.id, status: "submitted" as const, submittedAt: new Date() })) },
    } });
    await prisma.score.create({ data: { teamId: "t2", entries: { create: [{ inputId: inputs[0], value: 900 }] } } });
  });

  it("unlocked for correction, the team stays on the board; the saved correction re-ranks it", async () => {
    expect(await onBoard("t1")).toMatchObject({ scored: true, submitted: true, total: 400 });

    // Only BFT MENA Full access unlocks.
    as(actors.organiser);
    expect(await unlockScore("t1")).toEqual({ ok: false, error: "FORBIDDEN" });
    as(actors.hq);
    expect(await unlockScore("t1")).toEqual({ ok: true });
    expect((await prisma.score.findUniqueOrThrow({ where: { teamId: "t1" } })).status).toBe("draft");
    expect(await prisma.zoneScore.count({ where: { score: { teamId: "t1" }, status: "submitted" } })).toBe(0);

    // Still on the board, every zone shown, the same total — no longer final.
    const unlocked = await onBoard("t1");
    expect(unlocked).toMatchObject({ scored: true, submitted: false, total: 400 });
    expect(unlocked.zones.every((zone) => zone.submitted && zone.points === 100)).toBe(true);

    // The correction: Zone 1 is 250. Saved, the board moves; the score is final again.
    expect(await saveScore({ teamId: "t1", values: { [inputs[0]]: 250 } })).toEqual({ ok: true });
    expect(await onBoard("t1")).toMatchObject({ scored: true, submitted: true, total: 550 });
    expect((await prisma.score.findUniqueOrThrow({ where: { teamId: "t1" } })).status).toBe("submitted");
  });

  it("a zone never submitted never reaches the board — draft or not", async () => {
    const draftOnly = await onBoard("t2");
    expect(draftOnly).toMatchObject({ scored: false, submitted: false, total: 0 });
    expect(JSON.stringify(await buildBoardPayload("s1"))).not.toContain("900");
  });
});
