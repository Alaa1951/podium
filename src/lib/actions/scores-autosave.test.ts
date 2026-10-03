import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findTeam: vi.fn(),
  findConsoleTeam: vi.fn(),
  countTeam: vi.fn(),
  findPost: vi.fn(),
  findWaves: vi.fn(),
  getSeriesZones: vi.fn(),
  transaction: vi.fn(),
  lockTeam: vi.fn(),
  readScore: vi.fn(),
  writeEntry: vi.fn(),
  writeZone: vi.fn(),
  writeScore: vi.fn(),
  auditChanges: vi.fn(),
  notifyBoardChanged: vi.fn(),
  revalidate: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/session", async () => {
  const access = await vi.importActual<typeof import("@/lib/access")>("@/lib/access");
  return { requireUser: mocks.requireUser, can: access.can, canWriteScore: access.canWriteScore, teamScope: () => ({}) };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    team: { findUnique: mocks.findTeam, findFirst: mocks.findConsoleTeam, count: mocks.countTeam },
    zoneStaff: { findUnique: mocks.findPost },
    wave: { findMany: mocks.findWaves },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/queries", () => ({ getSeriesZones: mocks.getSeriesZones }));
vi.mock("@/lib/wave-clock", () => ({
  floorTimingFor: vi.fn(async () => ({ workMinutes: 15, breakMinutes: 5, zoneCount: 3 })),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit, AUDIT: { zoneScoreSaved: "zone-score-saved" } }));
vi.mock("@/lib/board-events", () => ({ notifyBoardChanged: mocks.notifyBoardChanged }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: mocks.revalidate }));

import { saveScore, saveZoneScore, unlockScore } from "@/lib/actions/scores";
import type { ZoneDef } from "@/lib/zones";

const input = (id: string, position = 1) => ({
  id, position, label: id, unit: "reps", multiplyBy: 10, divideBy: 1, maxValue: null, inputMode: "number" as const,
});
const zones: ZoneDef[] = [
  { id: "zone-1", number: 1, name: "Zone 1", inputs: [input("reps-1")] },
  { id: "zone-2", number: 2, name: "Zone 2", inputs: [input("reps-2"), input("metres-2", 2)] },
  { id: "zone-3", number: 3, name: "Zone 3", inputs: [input("reps-3")] },
];
const consoleUser = { id: "console", role: "staff", permissions: ["scores.enter"] };
const judge = { id: "judge", role: "organiser", permissions: ["scores.enter", "judgeSheet.view"] };

let team: {
  id: string;
  seriesId: string;
  station: number;
  archivedAt: null;
  waveId: string;
  series: { status: "live"; scoreEntryClosesAt: Date | null };
  waveRef: { endsAt: Date };
  score: {
    id: string;
    status: "draft" | "submitted";
    entries: { inputId: string; value: number | null }[];
    zones: { zoneId: string; status: "draft" | "submitted" }[];
  };
};
let commitOrder: string[];

const onWave = (minutesAgo = 5) => [{
  id: "wave", status: "running", startedAt: new Date(Date.now() - minutesAgo * 60_000), endsAt: new Date(Date.now() + 60 * 60_000),
}];
const currentValues = () => Object.fromEntries(team.score.entries.map(({ inputId, value }) => [inputId, value]));
const consoleTap = (values = { "reps-1": 1 }) => saveScore({ teamId: team.id, values, autosave: true });
const judgeTap = (values = { "reps-1": 1 }) => saveZoneScore({ teamId: team.id, zoneId: "zone-1", values, autosave: true });

beforeEach(() => {
  vi.resetAllMocks();
  commitOrder = [];
  team = {
    id: "team", seriesId: "series", station: 1, archivedAt: null, waveId: "wave",
    series: { status: "live", scoreEntryClosesAt: null },
    waveRef: { endsAt: new Date(Date.now() + 60 * 60_000) },
    score: { id: "score", status: "draft", entries: [], zones: [] },
  };
  mocks.requireUser.mockResolvedValue(consoleUser);
  mocks.findTeam.mockImplementation(async () => team);
  mocks.findConsoleTeam.mockImplementation(async () => team);
  mocks.countTeam.mockResolvedValue(1);
  mocks.findPost.mockResolvedValue({ position: "judge", station: 1 });
  mocks.findWaves.mockResolvedValue(onWave());
  mocks.getSeriesZones.mockResolvedValue(zones);
  mocks.writeEntry.mockImplementation(async ({ create }: { create: { inputId: string; value: number | null } }) => {
    const existing = team.score.entries.find((entry) => entry.inputId === create.inputId);
    if (existing) existing.value = create.value;
    else team.score.entries.push({ inputId: create.inputId, value: create.value });
  });
  mocks.writeZone.mockImplementation(async ({ create }: { create: { zoneId: string; status: "submitted" } }) => {
    const existing = team.score.zones.find((zone) => zone.zoneId === create.zoneId);
    if (existing) existing.status = create.status;
    else team.score.zones.push({ zoneId: create.zoneId, status: create.status });
  });
  mocks.readScore.mockImplementation(async () => structuredClone(team.score));
  mocks.writeScore.mockImplementation(async ({ data }: { data: { status: "draft" | "submitted" } }) => { team.score.status = data.status; });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const result = await fn({
      $queryRaw: mocks.lockTeam,
      score: { findUnique: mocks.readScore, upsert: vi.fn(async () => ({ id: team.score.id, status: team.score.status })), update: mocks.writeScore },
      zoneEntry: { upsert: mocks.writeEntry },
      scoreAudit: { createMany: mocks.auditChanges, create: vi.fn() },
      zoneScore: {
        upsert: mocks.writeZone,
        count: vi.fn(async () => team.score.zones.filter((zone) => zone.status === "submitted").length),
        updateMany: vi.fn(async () => { team.score.zones.forEach((zone) => { zone.status = "draft"; }); }),
      },
    });
    commitOrder.push("commit");
    return result;
  });
  mocks.notifyBoardChanged.mockImplementation(() => { commitOrder.push("notify"); });
});

describe("live console counter writes", () => {
  it("keeps a complete one-input zone editable after the first +1 and the next tap", async () => {
    expect(await consoleTap()).toEqual({ ok: true });
    expect(await consoleTap({ "reps-1": 2 })).toEqual({ ok: true });
    expect(currentValues()).toEqual({ "reps-1": 2 });
    expect(team.score.status).toBe("draft");
    expect(mocks.writeZone).not.toHaveBeenCalled();
    expect(mocks.writeScore).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.notifyBoardChanged).toHaveBeenCalledTimes(2);
    expect(mocks.notifyBoardChanged).toHaveBeenLastCalledWith("series");
    expect(commitOrder).toEqual(["commit", "notify", "commit", "notify"]);
  });

  it("patches only the changed movement without erasing its neighbours or another zone", async () => {
    team.score.entries = [
      { inputId: "reps-2", value: 20 }, { inputId: "metres-2", value: 1500 }, { inputId: "reps-3", value: 8 },
    ];
    expect(await saveScore({ teamId: team.id, values: { "reps-2": 21 }, autosave: true })).toEqual({ ok: true });
    expect(currentValues()).toEqual({ "reps-2": 21, "metres-2": 1500, "reps-3": 8 });
    expect(mocks.writeEntry).toHaveBeenCalledTimes(1);
    expect(mocks.writeZone).not.toHaveBeenCalled();
  });

  it("still submits complete zones on the existing explicit save path", async () => {
    expect(await saveScore({ teamId: team.id, values: { "reps-1": 12 } })).toEqual({ ok: true });
    expect(team.score.zones).toEqual([{ zoneId: "zone-1", status: "submitted" }]);
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
    expect(await consoleTap({ "reps-1": 13 })).toEqual({ ok: false, error: "SCORE_LOCKED" });
    expect(mocks.notifyBoardChanged).toHaveBeenCalledTimes(1);
  });

  it("explicitly finalizes a team once its last complete zones are submitted", async () => {
    expect(await saveScore({ teamId: team.id, values: { "reps-1": 12, "reps-2": 8, "metres-2": 1000, "reps-3": 4 } })).toEqual({ ok: true });
    expect(team.score.zones).toHaveLength(3);
    expect(team.score.status).toBe("submitted");
    expect(mocks.writeScore).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
  });
});

describe("live judge counter writes", () => {
  beforeEach(() => { mocks.requireUser.mockResolvedValue(judge); });

  it("persists repeated taps without submitting the judge's zone", async () => {
    expect(await judgeTap()).toEqual({ ok: true });
    expect(await judgeTap({ "reps-1": 2 })).toEqual({ ok: true });
    expect(currentValues()).toEqual({ "reps-1": 2 });
    expect(mocks.writeZone).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(commitOrder).toEqual(["commit", "notify", "commit", "notify"]);
  });

  it("keeps previous inputs in a zone and ignores inputs belonging to another zone", async () => {
    mocks.findWaves.mockResolvedValue(onWave(25));
    team.score.entries = [{ inputId: "reps-2", value: 20 }, { inputId: "metres-2", value: 1500 }];
    expect(await saveZoneScore({ teamId: team.id, zoneId: "zone-2", values: { "reps-2": 21, "reps-3": 99 }, autosave: true })).toEqual({ ok: true });
    expect(currentValues()).toEqual({ "reps-2": 21, "metres-2": 1500 });
    expect(mocks.writeEntry).toHaveBeenCalledTimes(1);
  });

  it("explicitly submits using stored inputs as well as the final patch, even with autosave set", async () => {
    mocks.findWaves.mockResolvedValue(onWave(25));
    team.score.entries = [{ inputId: "metres-2", value: 1500 }];
    expect(await saveZoneScore({ teamId: team.id, zoneId: "zone-2", values: { "reps-2": 21 }, autosave: true, submit: true })).toEqual({ ok: true });
    expect(team.score.zones).toEqual([{ zoneId: "zone-2", status: "submitted" }]);
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
    expect(mocks.notifyBoardChanged).toHaveBeenCalledWith("series");
  });

  it("refuses incomplete explicit submission without broadcasting a change", async () => {
    mocks.findWaves.mockResolvedValue(onWave(25));
    expect(await saveZoneScore({ teamId: team.id, zoneId: "zone-2", values: { "reps-2": 21 }, autosave: true, submit: true })).toEqual({ ok: false, error: "INCOMPLETE" });
    expect(mocks.writeEntry).not.toHaveBeenCalled();
    expect(mocks.notifyBoardChanged).not.toHaveBeenCalled();
  });
});

describe.each([
  { name: "console", user: consoleUser, write: consoleTap },
  { name: "judge", user: judge, write: judgeTap },
])("$name autosave retains server protections", ({ user, write }) => {
  beforeEach(() => { mocks.requireUser.mockResolvedValue(user); });

  it("refuses a submitted zone without broadcasting a change", async () => {
    team.score.entries = [{ inputId: "reps-1", value: 10 }];
    team.score.zones = [{ zoneId: "zone-1", status: "submitted" }];
    expect(await write()).toEqual({ ok: false, error: "SCORE_LOCKED" });
    expect(mocks.writeEntry).not.toHaveBeenCalled();
    expect(mocks.notifyBoardChanged).not.toHaveBeenCalled();
  });

  it("refuses a writer without score entry permission", async () => {
    mocks.requireUser.mockResolvedValue({ ...user, permissions: [] });
    expect(await write()).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.notifyBoardChanged).not.toHaveBeenCalled();
  });

  it("never broadcasts or revalidates a failed transaction", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(write()).rejects.toThrow("database unavailable");
    expect(mocks.notifyBoardChanged).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("rereads locks after waiting behind another operator's submission", async () => {
    mocks.lockTeam.mockImplementation(async () => {
      team.score.entries = [{ inputId: "reps-1", value: 10 }];
      team.score.zones = [{ zoneId: "zone-1", status: "submitted" }];
    });
    expect(await write()).toEqual({ ok: false, error: "SCORE_LOCKED" });
    expect(mocks.lockTeam).toHaveBeenCalledTimes(1);
    expect(mocks.readScore.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.lockTeam.mock.invocationCallOrder[0]);
    expect(mocks.writeEntry).not.toHaveBeenCalled();
    expect(mocks.writeZone).not.toHaveBeenCalled();
    expect(mocks.notifyBoardChanged).not.toHaveBeenCalled();
  });

  it("also refuses a team finalized before its transaction obtained the lock", async () => {
    mocks.lockTeam.mockImplementation(async () => { team.score.status = "submitted"; });
    expect(await write()).toEqual({ ok: false, error: "SCORE_LOCKED" });
    expect(mocks.writeEntry).not.toHaveBeenCalled();
    expect(mocks.notifyBoardChanged).not.toHaveBeenCalled();
  });
});

describe("fresh values inside the team lock", () => {
  it("finalizes a console zone completed by another writer before it obtained the lock", async () => {
    mocks.lockTeam.mockImplementation(async () => { team.score.entries = [{ inputId: "metres-2", value: 1500 }]; });
    expect(await saveScore({ teamId: team.id, values: { "reps-2": 21 } })).toEqual({ ok: true });
    expect(team.score.zones).toEqual([{ zoneId: "zone-2", status: "submitted" }]);
    expect(currentValues()).toEqual({ "reps-2": 21, "metres-2": 1500 });
  });

  it("refuses a zone whose stored input was cleared before submission obtained the lock", async () => {
    mocks.requireUser.mockResolvedValue(judge);
    mocks.findWaves.mockResolvedValue(onWave(25));
    team.score.entries = [{ inputId: "metres-2", value: 1500 }];
    mocks.lockTeam.mockImplementation(async () => { team.score.entries = []; });
    expect(await saveZoneScore({ teamId: team.id, zoneId: "zone-2", values: { "reps-2": 21 }, submit: true })).toEqual({ ok: false, error: "INCOMPLETE" });
    expect(mocks.writeEntry).not.toHaveBeenCalled();
    expect(mocks.writeZone).not.toHaveBeenCalled();
    expect(mocks.notifyBoardChanged).not.toHaveBeenCalled();
  });

  it("audits the value it actually replaces after another writer's committed change", async () => {
    mocks.lockTeam.mockImplementation(async () => { team.score.entries = [{ inputId: "reps-1", value: 7 }]; });
    expect(await consoleTap({ "reps-1": 8 })).toEqual({ ok: true });
    expect(mocks.auditChanges).toHaveBeenCalledWith({ data: [expect.objectContaining({ oldValue: "7", newValue: "8" })] });
  });

  it("refuses even an unchanged judge patch when its zone was submitted while waiting", async () => {
    mocks.requireUser.mockResolvedValue(judge);
    mocks.lockTeam.mockImplementation(async () => {
      team.score.entries = [{ inputId: "reps-1", value: 1 }];
      team.score.zones = [{ zoneId: "zone-1", status: "submitted" }];
    });
    expect(await judgeTap()).toEqual({ ok: false, error: "SCORE_LOCKED" });
    expect(mocks.writeEntry).not.toHaveBeenCalled();
    expect(mocks.notifyBoardChanged).not.toHaveBeenCalled();
  });

  it("drops an unchanged console grid field from a zone submitted while waiting", async () => {
    mocks.lockTeam.mockImplementation(async () => {
      team.score.entries = [{ inputId: "reps-1", value: 1 }];
      team.score.zones = [{ zoneId: "zone-1", status: "submitted" }];
    });
    expect(await consoleTap()).toEqual({ ok: true });
    expect(mocks.writeEntry).not.toHaveBeenCalled();
    expect(mocks.writeZone).not.toHaveBeenCalled();
  });

  it("keeps Full access correction available after another operator's submission", async () => {
    mocks.requireUser.mockResolvedValue({ id: "admin", role: "admin", permissions: ["*"] });
    mocks.lockTeam.mockImplementation(async () => {
      team.score.status = "submitted";
      team.score.entries = [{ inputId: "reps-1", value: 1 }];
      team.score.zones = [{ zoneId: "zone-1", status: "submitted" }];
    });
    expect(await consoleTap({ "reps-1": 2 })).toEqual({ ok: true });
    expect(currentValues()).toEqual({ "reps-1": 2 });
  });

  it("unlocks under the same team lock before allowing later score writes", async () => {
    mocks.requireUser.mockResolvedValue({ id: "admin", role: "admin", permissions: ["*"] });
    team.score.status = "submitted";
    team.score.zones = [{ zoneId: "zone-1", status: "submitted" }];
    expect(await unlockScore(team.id)).toEqual({ ok: true });
    expect(mocks.lockTeam).toHaveBeenCalledTimes(1);
    expect(mocks.writeScore.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.lockTeam.mock.invocationCallOrder[0]);
    expect(team.score.status).toBe("draft");
    expect(team.score.zones).toEqual([{ zoneId: "zone-1", status: "draft" }]);
    expect(commitOrder).toEqual(["commit", "notify"]);
  });
});
