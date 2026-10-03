import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { fillFinisherTimes } from "@/lib/wave-clock";

const clockInputs = [
  { id: "minutes", inputMode: "minutes" },
  { id: "seconds", inputMode: "seconds" },
];
const wave = { id: "wave", seriesId: "series" };
const tx = {
  zoneInput: { findMany: vi.fn() },
  score: { findMany: vi.fn() },
  zoneEntry: { upsert: vi.fn() },
  $queryRaw: vi.fn(),
};
const db = tx as unknown as Prisma.TransactionClient;
let rows: { id: string; inputId: string | null; value: number | null }[];
let locked: boolean;

beforeEach(() => {
  vi.resetAllMocks();
  locked = false;
  rows = [{ id: "score", inputId: "reps", value: 10 }];
  tx.zoneInput.findMany.mockResolvedValue(clockInputs);
  tx.score.findMany.mockResolvedValue([{ teamId: "team" }]);
  tx.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => {
    if (sql.join("").includes("FROM Team")) {
      locked = true;
      return [{ id: "team" }];
    }
    expect(locked).toBe(true);
    expect(sql.join("")).toContain("FOR UPDATE");
    return structuredClone(rows);
  });
});

describe("finisher autofill under the score writer's team lock", () => {
  it("fills both uncaptured clock halves using the remaining wave time", async () => {
    expect(await fillFinisherTimes(db, wave, 149_000)).toBe(1);
    expect(tx.score.findMany).toHaveBeenCalledWith({
      where: { team: { waveId: "wave", archivedAt: null } }, orderBy: { teamId: "asc" }, select: { teamId: true },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.zoneEntry.upsert.mock.calls.map(([args]) => args.create)).toEqual([
      { scoreId: "score", inputId: "minutes", value: 2 },
      { scoreId: "score", inputId: "seconds", value: 29 },
    ]);
    expect(tx.zoneEntry.upsert.mock.invocationCallOrder[0]).toBeGreaterThan(tx.$queryRaw.mock.invocationCallOrder[1]);
  });

  it("preserves a judge's capture committed after the initial score list and before the team lock", async () => {
    tx.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => {
      if (sql.join("").includes("FROM Team")) {
        rows = [{ id: "score", inputId: "minutes", value: 0 }, { id: "score", inputId: "seconds", value: 19 }];
        return [{ id: "team" }];
      }
      return structuredClone(rows);
    });
    expect(await fillFinisherTimes(db, wave, 0)).toBe(0);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.zoneEntry.upsert).not.toHaveBeenCalled();
  });

  it.each([
    { inputId: "minutes", value: 0 },
    { inputId: "minutes", value: 2 },
    { inputId: "seconds", value: 19 },
  ])("leaves a partial captured clock untouched ($inputId=$value)", async (entry) => {
    rows = [{ id: "score", ...entry }];
    expect(await fillFinisherTimes(db, wave, 0)).toBe(0);
    expect(tx.zoneEntry.upsert).not.toHaveBeenCalled();
  });

  it("fills an existing score with no entries and overwrites null clock halves only", async () => {
    rows = [{ id: "score", inputId: null, value: null }];
    expect(await fillFinisherTimes(db, wave, 0)).toBe(1);
    expect(tx.zoneEntry.upsert.mock.calls.map(([args]) => args.create.value)).toEqual([0, 0]);
    tx.zoneEntry.upsert.mockClear();
    rows = [{ id: "score", inputId: "minutes", value: null }, { id: "score", inputId: "seconds", value: null }];
    expect(await fillFinisherTimes(db, wave, 61_000)).toBe(1);
    expect(tx.zoneEntry.upsert.mock.calls.map(([args]) => args.create.value)).toEqual([1, 1]);
  });

  it("does not invent a score for a no-show", async () => {
    tx.score.findMany.mockResolvedValue([]);
    expect(await fillFinisherTimes(db, wave, 0)).toBe(0);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.zoneEntry.upsert).not.toHaveBeenCalled();
  });

  it("skips a score removed before its team lock was obtained", async () => {
    rows = [];
    expect(await fillFinisherTimes(db, wave, 0)).toBe(0);
    expect(tx.zoneEntry.upsert).not.toHaveBeenCalled();
  });

  it("does nothing when the definition has no complete finisher clock", async () => {
    tx.zoneInput.findMany.mockResolvedValue([{ id: "minutes", inputMode: "minutes" }]);
    expect(await fillFinisherTimes(db, wave, 0)).toBe(0);
    expect(tx.score.findMany).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.zoneEntry.upsert).not.toHaveBeenCalled();
  });
});
