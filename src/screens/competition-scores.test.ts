import { isValidElement, createElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSeries: vi.fn(), seriesHref: vi.fn(), teams: vi.fn(), zones: vi.fn(), audit: vi.fn(),
  requireConsoleAccess: vi.fn(), can: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
// The chips are links; render them as anchors so the walk can read their hrefs.
vi.mock("next/link", () => ({
  default: (props: { href: string; className?: string; children?: ReactNode }) =>
    createElement("a", { href: props.href, className: props.className }, props.children),
}));
vi.mock("@/components/scores/score-grid", () => ({ ScoreGrid: () => null }));
vi.mock("@/components/scores/waves-timer", () => ({ WavesTimer: () => null }));
vi.mock("@/lib/i18n/server", () => ({ getTranslator: async () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/queries", () => ({ getScopedTeams: mocks.teams, getSeriesZones: mocks.zones }));
vi.mock("@/lib/queries-people", () => ({ getSeriesScoreAudit: mocks.audit }));
vi.mock("@/lib/require-series", () => ({
  requireSeries: mocks.requireSeries,
  seriesHref: (slug: string, path: string) => `/series/${slug}/${path}`,
}));
vi.mock("@/lib/access", () => ({ can: mocks.can }));
vi.mock("@/lib/session", () => ({ requireConsoleAccess: mocks.requireConsoleAccess }));

import { ScoreGrid } from "@/components/scores/score-grid";
import ScoresPage from "@/screens/competition-scores";

const series = { id: "series-1", name: "Podium BFT Series 1", slug: "podium-bft-series-1", status: "live", zoneWorkMinutes: 15 };
const waves = [
  { id: "w1", number: 1, remainingMs: null, endsAt: "2026-10-03T08:00:00.000Z" },
  { id: "w2", number: 2, remainingMs: null, endsAt: null },
];

const team = (id: string, over: Record<string, unknown> = {}) => ({
  id, number: 100, name: `Team ${id}`, category: "Mens", division: "Open",
  wave: 1, waveId: "w1", station: 1, competitors: [{ fullName: "Athlete" }],
  submitted: false, lockedZones: [], scoreEdits: 0, paymentStatus: "paid",
  waitlistedAt: null, groupPortraitPath: null, values: {}, total: 0, ...over,
});

/** The field as production held it on 2026-10-03: two placed waves, plus teams
 * admitted but never seated — which carry the loose default number, wave 1. */
const field = [
  team("t1", { number: 103, wave: 1, waveId: "w1", station: 5 }),
  team("t2", { number: 110, wave: 2, waveId: "w2", station: 2 }),
  team("t3", { number: 203, wave: 1, waveId: null, station: null }),
  team("t4", { number: 221, wave: 1, waveId: null, station: null }),
  // A loose number with no wave behind it at all — the old number-based
  // filter turned this into a chip for an empty "Wave 7".
  team("t5", { number: 230, wave: 7, waveId: null, station: null }),
];

async function page(searchParams: Record<string, string | undefined> = {}) {
  const nodes = elements(await ScoresPage({
    params: Promise.resolve({ series: series.slug }),
    searchParams: Promise.resolve(searchParams),
  }));
  const grids = nodes.filter((node) => node.type === ScoreGrid).map((node) => node.props as { teams: { id: string; wave: number | null; waveEndsAt: string | null; waveEnded: boolean }[] });
  const chips = nodes
    .filter((node) => isValidElement(node) && node.props.className === "chip")
    .map((node) => node.props as { href: string; "data-active"?: boolean });
  return { grids, chips };
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

describe("the score sheet narrows by real wave membership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSeries.mockResolvedValue({ series, waves, waveSummary: { runningNumbers: [] } });
    mocks.teams.mockResolvedValue(field);
    mocks.zones.mockResolvedValue([]);
    mocks.audit.mockResolvedValue(new Map());
    mocks.requireConsoleAccess.mockResolvedValue({ viewAs: false, role: "staff", id: "u1" });
    mocks.can.mockReturnValue(false);
  });

  it("wave 1 shows only the teams PLACED in wave 1 — not every team carrying the number", async () => {
    const { grids } = await page({ wave: "1" });
    expect(grids[0].teams.map((team) => team.id)).toEqual(["t1"]);
  });

  it("teams without a wave get their own view and none of wave 1's clock", async () => {
    const none = await page({ wave: "none" });
    expect(none.grids[0].teams.map((team) => team.id)).toEqual(["t3", "t4", "t5"]);
    // Wave 1 ended at 08:00; an unplaced team must not read that as its own.
    expect(none.grids[0].teams.every((team) => team.wave === null && team.waveEndsAt === null && !team.waveEnded)).toBe(true);

    const all = await page();
    expect(all.grids[0].teams.map((team) => team.id)).toEqual(["t1", "t2", "t3", "t4", "t5"]);
  });

  it("the chips come from waves that hold teams, with one slot for the unplaced", async () => {
    const { chips } = await page();
    expect(chips.map((chip) => chip.href)).toEqual([
      "/series/podium-bft-series-1/scores",
      "/series/podium-bft-series-1/scores?wave=1",
      "/series/podium-bft-series-1/scores?wave=2",
      "/series/podium-bft-series-1/scores?wave=none",
    ]);
    expect(chips.some((chip) => chip.href.endsWith("wave=7"))).toBe(false);
  });

  it("marks the active chip", async () => {
    const none = await page({ wave: "none" });
    expect(none.chips.find((chip) => chip.href.endsWith("wave=none"))?.["data-active"]).toBe(true);
    const one = await page({ wave: "1" });
    expect(one.chips.find((chip) => chip.href.endsWith("wave=1"))?.["data-active"]).toBe(true);
    expect(one.chips.find((chip) => chip.href.endsWith("wave=none"))?.["data-active"]).toBeUndefined();
  });

  it("a placed team still reads its own wave clock", async () => {
    const { grids } = await page({ wave: "1" });
    expect(grids[0].teams[0].wave).toBe(1);
    expect(grids[0].teams[0].waveEndsAt).toBe("2026-10-03T08:00:00.000Z");
    expect(grids[0].teams[0].waveEnded).toBe(true);
  });
});
