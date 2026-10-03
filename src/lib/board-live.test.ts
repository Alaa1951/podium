import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  status: "live" as "live" | "scheduled" | "final",
  values: {} as Record<string, number | null>,
  publishedZones: [] as string[],
  wavesComplete: false,
  resultsPublicAt: null as Date | null,
  boardOpensAt: null as Date | null,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ownership", () => ({ onTheFloor: () => true }));
vi.mock("@/lib/queries", () => ({
  getSeries: async () => ({
    id: "live-board-test", name: "Live test", status: fixture.status,
    competitionDate: new Date("2026-10-03T06:00:00Z"),
    zoneWorkMinutes: 10, zoneBreakMinutes: 1, waveMinutes: 44,
    sponsorsEnabled: false, boardOpensAt: fixture.boardOpensAt,
    resultsPublicAt: fixture.resultsPublicAt, _count: { teams: 1 },
    showTeamName: true, showCompetitorNames: true, showStudioColumn: true,
  }),
  getSeriesWaves: async () => fixture.wavesComplete ? [{
    id: "w1", number: 1, status: "complete", startTime: "09:00", durationMinutes: 44,
    startedAt: "2026-10-03T06:00:00Z", endsAt: "2026-10-03T06:44:00Z", teamCount: 1,
  }] : [],
  getSeriesZones: async () => [
    { id: "z1", number: 1, name: "Strength", inputs: [{ id: "reps" }, { id: "bench" }] },
    { id: "z2", number: 2, name: "Conditioning", inputs: [{ id: "metres" }] },
  ],
  getSeriesTeams: async () => [{
    id: "team-live", number: 1, name: "Counting", category: "Mens", division: "Open",
    waveId: null, station: 1, competitors: [], studioName: null,
    groupPortraitPath: null, submitted: false, values: fixture.values,
    publishedZones: fixture.publishedZones,
    zones: [
      { id: "z1", number: 1, name: "Strength", points: (fixture.values.reps ?? 0) * 10 },
      { id: "z2", number: 2, name: "Conditioning", points: (fixture.values.metres ?? 0) / 100 },
    ],
  }],
}));

import { buildBoardPayload } from "@/lib/board";

describe("live board publication", () => {
  beforeEach(() => {
    fixture.status = "live";
    fixture.values = {};
    fixture.publishedZones = [];
    fixture.wavesComplete = false;
    fixture.resultsPublicAt = null;
    fixture.boardOpensAt = null;
  });

  it("shows saved partial entries during live counting without making the score final", async () => {
    fixture.values = { reps: 3, bench: null, metres: null };
    const board = await buildBoardPayload("live-board-test");
    expect(board!.teams[0]).toMatchObject({ scored: true, submitted: false, total: 30 });
    expect(board!.teams[0].zones).toEqual([
      { number: 1, name: "Strength", points: 30, submitted: true },
      { number: 2, name: "Conditioning", points: 0, submitted: false },
    ]);
  });

  it("a saved zero is a score, while missing and cleared values are not", async () => {
    fixture.values = { reps: 0 };
    expect((await buildBoardPayload("live-board-test"))!.teams[0].scored).toBe(true);
    fixture.values = { reps: null };
    expect((await buildBoardPayload("live-board-test"))!.teams[0].scored).toBe(false);
  });

  it.each(["scheduled", "final"] as const)("%s retains submission gates even when draft entries exist", async (status) => {
    fixture.status = status;
    fixture.values = { reps: 900, metres: 200 };
    fixture.publishedZones = ["z2"];
    const team = (await buildBoardPayload("live-board-test"))!.teams[0];
    expect(team).toMatchObject({ scored: true, submitted: false, total: 2 });
    expect(team.zones[0]).toMatchObject({ submitted: false, points: 0 });
  });

  it.each([false, true])("completed waves exclude unsubmitted counters even with live status (public=%s)", async (published) => {
    fixture.wavesComplete = true;
    fixture.resultsPublicAt = published ? new Date(0) : null;
    fixture.values = { reps: 900, metres: 200 };
    fixture.publishedZones = ["z2"];
    expect((await buildBoardPayload("live-board-test"))!.teams[0]).toMatchObject({ total: 2 });
  });

  it("live rehearsal before board activation still excludes draft counters", async () => {
    fixture.boardOpensAt = new Date(Date.now() + 60_000);
    fixture.values = { reps: 900 };
    expect((await buildBoardPayload("live-board-test"))!.teams[0]).toMatchObject({ scored: false, total: 0 });
  });
});
