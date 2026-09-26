/**
 * The judge's write, end to end through the server action: which wave a zone
 * is ON decides which team a judge may score. The pure rules are tested in
 * floor.test.ts and zone-score-rules.test.ts; this proves the action feeds
 * them the right facts from the database — every wave of the competition,
 * the team's own wave, the post, the clock.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findTeam: vi.fn(),
  countTeam: vi.fn(),
  findPost: vi.fn(),
  findWaves: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/session", async () => {
  const access = await vi.importActual<typeof import("@/lib/access")>("@/lib/access");
  return { requireUser: mocks.requireUser, can: access.can, canWriteScore: access.canWriteScore, teamScope: () => ({}) };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    team: { findUnique: mocks.findTeam, count: mocks.countTeam },
    zoneStaff: { findUnique: mocks.findPost },
    wave: { findMany: mocks.findWaves },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/queries", () => ({
  getSeriesZones: vi.fn(async () =>
    [1, 2, 3, 4].map((number) => ({
      id: `zone-${number}`,
      number,
      name: `Zone ${number}`,
      inputs: [
        { id: `reps-${number}`, position: 1, label: "Reps", unit: "reps", multiplyBy: 10, divideBy: 1, maxValue: null, inputMode: "number" },
      ],
    }))
  ),
}));
vi.mock("@/lib/wave-clock", () => ({
  floorTimingFor: vi.fn(async () => ({ workMinutes: 15, breakMinutes: 5, zoneCount: 4 })),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(), AUDIT: {} }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: vi.fn() }));

import { saveZoneScore } from "@/lib/actions/scores";

const MIN = 60_000;
const judge = { id: "judge-1", role: "organiser", permissions: ["judgeSheet.view", "scores.enter"] };
const leader = { id: "leader-1", role: "organiser", permissions: ["judgeSheet.view", "scores.enter"] };

/** A wave that started `minutesAgo` minutes ago and runs its full 75. */
const wave = (id: string, minutesAgo: number, status: "running" | "complete" = "running", endedMinutesAgo?: number) => {
  const startedAt = new Date(Date.now() - minutesAgo * MIN);
  const endsAt =
    endedMinutesAgo === undefined ? new Date(startedAt.getTime() + 75 * MIN) : new Date(Date.now() - endedMinutesAgo * MIN);
  return { id, status, startedAt, endsAt };
};

const teamOn = (waveId: string, station = 1) => ({
  id: "team-a",
  seriesId: "series",
  station,
  archivedAt: null,
  waveId,
  series: { status: "live", scoreEntryClosesAt: null },
  score: { entries: [], zones: [] },
});

const write = (zoneNumber: number) =>
  saveZoneScore({ teamId: "team-a", zoneId: `zone-${zoneNumber}`, values: { [`reps-${zoneNumber}`]: 12 } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue(judge);
  mocks.countTeam.mockResolvedValue(1);
  mocks.findPost.mockResolvedValue({ position: "judge", station: 1 });
  // The write itself: an empty score, then the entry, no audit worth checking.
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      score: { upsert: vi.fn(async () => ({ id: "score", status: "draft" })), update: vi.fn() },
      zoneEntry: { upsert: vi.fn() },
      scoreAudit: { createMany: vi.fn() },
      zoneScore: { upsert: vi.fn(), count: vi.fn(async () => 0) },
    })
  );
});

describe("a judge writes only the wave their zone is on", () => {
  it("scores the team working in their zone", async () => {
    mocks.findTeam.mockResolvedValue(teamOn("w1"));
    mocks.findWaves.mockResolvedValue([wave("w1", 5)]);
    expect(await write(1)).toEqual({ ok: true });
  });

  it("still scores it in the changeover, and after it moves on — until the next wave arrives", async () => {
    mocks.findTeam.mockResolvedValue(teamOn("w1"));
    mocks.findWaves.mockResolvedValue([wave("w1", 17)]); // Zone 1 changeover
    expect(await write(1)).toEqual({ ok: true });
    mocks.findWaves.mockResolvedValue([wave("w1", 25)]); // in Zone 2 now; nothing newer in Zone 1
    expect(await write(1)).toEqual({ ok: true });
  });

  it("is refused once the next wave has reached the zone", async () => {
    mocks.findTeam.mockResolvedValue(teamOn("w1"));
    mocks.findWaves.mockResolvedValue([wave("w1", 25), wave("w2", 3)]);
    expect(await write(1)).toEqual({ ok: false, error: "WAVE_MOVED_ON" });
  });

  it("is refused a wave that has not reached the zone yet", async () => {
    mocks.findTeam.mockResolvedValue(teamOn("w1"));
    mocks.findPost.mockResolvedValue({ position: "judge", station: 1 });
    mocks.findWaves.mockResolvedValue([wave("w1", 5)]); // still in Zone 1
    expect(await write(2)).toEqual({ ok: false, error: "WAVE_NOT_HERE" });
  });

  it("is refused a zone a wave never reached because it was ended early", async () => {
    mocks.findTeam.mockResolvedValue(teamOn("w1"));
    // Ended with End now at minute 10 of Zone 1, half an hour ago.
    mocks.findWaves.mockResolvedValue([wave("w1", 40, "complete", 30)]);
    expect(await write(2)).toEqual({ ok: false, error: "WAVE_NOT_HERE" });
    expect(await write(1)).toEqual({ ok: true });
  });

  it("is refused another station's team", async () => {
    mocks.findTeam.mockResolvedValue(teamOn("w1", 2));
    mocks.findWaves.mockResolvedValue([wave("w1", 5)]);
    expect(await write(1)).toEqual({ ok: false, error: "WRONG_STATION" });
  });
});

describe("the zone leader is the safety valve", () => {
  it("finishes an earlier wave's open sheet after the next wave arrived", async () => {
    mocks.requireUser.mockResolvedValue(leader);
    mocks.findPost.mockResolvedValue({ position: "leader", station: null });
    mocks.findTeam.mockResolvedValue(teamOn("w1", 4));
    mocks.findWaves.mockResolvedValue([wave("w1", 25), wave("w2", 3)]);
    expect(await write(1)).toEqual({ ok: true });
  });

  it("but never a wave that did not reach the zone", async () => {
    mocks.requireUser.mockResolvedValue(leader);
    mocks.findPost.mockResolvedValue({ position: "leader", station: null });
    mocks.findTeam.mockResolvedValue(teamOn("w1", 4));
    mocks.findWaves.mockResolvedValue([wave("w1", 5)]);
    expect(await write(3)).toEqual({ ok: false, error: "WAVE_NOT_HERE" });
  });
});
