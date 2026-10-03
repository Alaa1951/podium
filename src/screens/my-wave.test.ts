import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ZoneEntryTeam } from "@/components/floor/zone-entry-card";
import type { PermissionKey } from "@/lib/permissions/catalog";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), posts: vi.fn(), zones: vi.fn(), allWaves: vi.fn(), staff: vi.fn(),
  series: vi.fn(), waves: vi.fn(), teams: vi.fn(), day: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/lib/participation", () => ({ resolveMySeries: vi.fn(), meHref: () => "/me" }));
vi.mock("@/components/app/plain-header", () => ({ PlainHeader: () => null }));
vi.mock("@/components/floor/sheet-refresher", () => ({ SheetRefresher: () => null }));
vi.mock("@/components/floor/zone-entry-card", () => ({ ZoneEntryCard: () => null }));
vi.mock("@/components/floor/zone-staff-panel", () => ({ ZoneStaffPanel: () => null }));
vi.mock("@/components/floor/wave-floor", () => ({ WaveFloor: () => null }));
vi.mock("@/components/floor/judge-day", () => ({ JudgeDay: () => null }));
vi.mock("@/components/me/wave-change-panel", () => ({ WaveChangePanel: () => null }));
vi.mock("@/lib/i18n/server", () => ({ getTranslator: async () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/judge-day", () => ({ loadJudgeDay: mocks.day }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  series: { findUnique: mocks.series }, wave: { findMany: mocks.waves }, team: { findMany: mocks.teams },
} }));
vi.mock("@/lib/queries", () => ({ getSeriesWaves: mocks.allWaves, getSeriesZones: mocks.zones }));
vi.mock("@/lib/session", () => ({ requireUser: mocks.requireUser, homeFor: () => "/home" }));
vi.mock("@/lib/zone-staff", () => ({ judgePostsFor: mocks.posts, listZoneStaff: mocks.staff }));

import { ZoneEntryCard } from "@/components/floor/zone-entry-card";
import { WaveFloor } from "@/components/floor/wave-floor";
import { ZoneStaffPanel } from "@/components/floor/zone-staff-panel";
import MyWavePage from "@/screens/my-wave";

const now = new Date("2026-10-03T10:10:00Z");
const series = { id: "series", name: "Test floor", slug: "test-floor", status: "live" as const, waveCapacity: 6 };
const leaderPost = {
  id: "post-leader", position: "leader" as const, station: null, seriesId: series.id, series,
  zone: { id: "z1", number: 1, name: "Strength" },
};
const input = { id: "reps1", position: 1, label: "Reps", unit: "reps", multiplyBy: 10, divideBy: 1, maxValue: 100, inputMode: "number" };
const team = (id: string, waveId = "current", station = 1, locked = false) => ({
  id, number: station, name: `Team ${id}`, station, waveId, competitors: [{ fullName: "Athlete" }],
  score: { updatedAt: new Date("2026-10-03T10:05:00Z"), entries: [{ inputId: "reps1", value: 7 }, { inputId: "reps2", value: 999 }], zones: locked ? [{ zoneId: "z1" }] : [] },
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

async function sheet(detailId?: string) {
  const nodes = elements(await MyWavePage(detailId));
  const cards = nodes.filter((node) => node.type === ZoneEntryCard)
    .map((node) => node.props as { team: ZoneEntryTeam; canEnterCountDirectly: boolean });
  return { nodes, cards };
}

describe("zone score sheet data boundary and leader windows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.requireUser.mockResolvedValue({ id: "leader", name: "Leader", role: "organiser", permissions: ["judgeSheet.leaderView", "scores.enter"] satisfies PermissionKey[] });
    mocks.posts.mockResolvedValue([leaderPost]);
    mocks.zones.mockResolvedValue([
      { ...leaderPost.zone, inputs: [input] },
      { id: "z2", number: 2, name: "Finisher", inputs: [{ ...input, id: "reps2" }] },
    ]);
    mocks.series.mockResolvedValue({ status: "live", zoneWorkMinutes: 15, zoneBreakMinutes: 5, scoreEntryClosesAt: null });
    mocks.waves.mockResolvedValue([
      { id: "current", number: 2, status: "running", startedAt: new Date("2026-10-03T10:00:00Z"), endsAt: new Date("2026-10-03T10:35:00Z") },
      { id: "earlier", number: 1, status: "running", startedAt: new Date("2026-10-03T09:30:00Z"), endsAt: new Date("2026-10-03T10:05:00Z") },
    ]);
    mocks.teams.mockResolvedValue([team("a"), team("b", "current", 2), team("old", "earlier"), team("submitted", "earlier", 2, true)]);
    mocks.staff.mockResolvedValue([{ ...leaderPost.zone, staff: [] }]);
    mocks.day.mockResolvedValue(null);
    mocks.allWaves.mockResolvedValue([]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it("opens all leader stations with typed counts, filters other posts, and gives no Start or placement", async () => {
    mocks.posts.mockResolvedValue([leaderPost, { ...leaderPost, id: "leftover-judge", position: "judge", station: 1, zone: { id: "z2", number: 2, name: "Finisher" } }]);
    const { nodes, cards } = await sheet();
    expect(cards.map((card) => card.team.id)).toEqual(["a", "b", "old", "submitted"]);
    expect(cards.every((card) => card.canEnterCountDirectly)).toBe(true);
    expect(mocks.teams).toHaveBeenCalledTimes(1);
    expect(mocks.teams.mock.calls[0][0].where.station).toBeUndefined();
    expect(nodes.filter((node) => node.type === WaveFloor)).toHaveLength(0);
    expect(nodes.find((node) => node.type === ZoneStaffPanel)?.props.canPlace).toBe(false);
  });

  it("restricts the query and serialized values to the post's zone even on a detail route", async () => {
    mocks.teams.mockResolvedValue([team("a")]);
    const { cards } = await sheet("a");
    expect(mocks.teams.mock.calls[0][0].where.id).toBe("a");
    expect(mocks.teams.mock.calls[0][0].select.score.select.entries.where).toEqual({ input: { zoneId: "z1" } });
    expect(cards[0].team.values).toEqual({ reps1: 7 });
    expect(cards[0].team.scoreRevision).toBe("2026-10-03T10:05:00.000Z");
    expect(mocks.teams.mock.calls[0][0].select.score.select.updatedAt).toBe(true);
    expect(JSON.stringify(cards)).not.toContain("reps2");
  });

  it("keeps old draft and submitted sheets visible but closed at the rotation deadline", async () => {
    const { cards } = await sheet();
    expect(cards[0].team.entryClosesAt).toBe("2026-10-03T10:20:00.000Z");
    expect(cards[0].team.entryClosedReason).toBeNull();
    expect(cards.find((card) => card.team.id === "old")?.team.entryClosedReason).toBe("ZONE_ENTRY_CLOSED");
    expect(cards.find((card) => card.team.id === "submitted")?.team.locked).toBe(true);
    vi.setSystemTime(new Date("2026-10-03T10:20:00Z"));
    expect((await sheet()).cards[0].team.entryClosedReason).toBe("ZONE_ENTRY_CLOSED");
  });

  it("clips entry to the competition cutoff and early wave End", async () => {
    mocks.series.mockResolvedValue({ status: "live", zoneWorkMinutes: 15, zoneBreakMinutes: 5, scoreEntryClosesAt: new Date("2026-10-03T10:12:00Z") });
    let cards = (await sheet()).cards;
    expect(cards[0].team.entryClosesAt).toBe("2026-10-03T10:12:00.000Z");
    expect(cards[0].team.entryDeadlineReason).toBe("SCORE_ENTRY_CLOSED");
    vi.setSystemTime(new Date("2026-10-03T10:12:00Z"));
    expect((await sheet()).cards[0].team.entryClosedReason).toBe("SCORE_ENTRY_CLOSED");
    vi.setSystemTime(now);
    mocks.waves.mockResolvedValue([{ id: "current", number: 2, status: "complete", startedAt: new Date("2026-10-03T10:00:00Z"), endsAt: new Date("2026-10-03T10:08:00Z") }]);
    mocks.teams.mockResolvedValue([team("a")]);
    cards = (await sheet()).cards;
    expect(cards[0].team.entryClosesAt).toBe("2026-10-03T10:08:00.000Z");
    expect(cards[0].team.entryClosedReason).toBe("ZONE_ENTRY_CLOSED");
  });

  it("keeps judge station controls and post-duty write window intact", async () => {
    mocks.requireUser.mockResolvedValue({ id: "judge", role: "organiser", permissions: ["judgeSheet.view", "scores.enter"] });
    mocks.posts.mockResolvedValue([{ ...leaderPost, position: "judge", station: 1 }]);
    mocks.teams.mockResolvedValue([team("a")]);
    vi.setSystemTime(new Date("2026-10-03T10:25:00Z"));
    const { cards } = await sheet();
    expect(mocks.teams.mock.calls[0][0].where.station).toBe(1);
    expect(cards[0].canEnterCountDirectly).toBe(false);
    expect(cards[0].team.entryClosesAt).toBeNull();
    expect(cards[0].team.entryClosedReason).toBeNull();
  });

  it("renders saved scores read-only when write permission is removed or in a preview", async () => {
    mocks.requireUser.mockResolvedValue({ id: "leader", role: "organiser", permissions: ["judgeSheet.leaderView"] });
    expect((await sheet()).cards[0].team.entryClosedReason).toBe("FORBIDDEN");
    mocks.requireUser.mockResolvedValue({ id: "leader", role: "organiser", permissions: ["judgeSheet.leaderView", "scores.enter"], viewAs: { byAdminId: "admin" } });
    expect((await sheet()).cards[0].team.entryClosedReason).toBe("FORBIDDEN");
  });
});
