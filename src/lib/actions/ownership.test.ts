/**
 * BFT MENA setting who registered a team: nobody else may, the choice must
 * name a real seat with an email, and every change is audited before → after.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "s1" }]),
    team: { findUnique: vi.fn(), update: vi.fn() },
  };
  return { db, requireAccess: vi.fn(), findSeries: vi.fn(), transaction: vi.fn(), audit: vi.fn() };
});

vi.mock("@/lib/session", () => ({ requireAccess: mocks.requireAccess }));
vi.mock("@/lib/prisma", () => ({ prisma: { team: { findUnique: mocks.findSeries }, $transaction: mocks.transaction } }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.audit, AUDIT: { teamOwnershipChanged: "ownership" } }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: vi.fn() }));

import { setTeamOwnership } from "@/lib/actions/ownership";

const bft = { id: "hq", role: "admin" };
const team = (over: object = {}) => ({
  id: "t1", number: 7, name: "FALCONS", archivedAt: null,
  ownership: "unknown", registrantEmail: null, registrantUserId: null,
  competitors: [
    { id: "a", userId: "u-mona", email: "mona@example.com" },
    { id: "b", userId: null, email: "Sara@Example.com" },
    { id: "c", userId: null, email: null },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(bft);
  mocks.findSeries.mockResolvedValue({ seriesId: "s1" });
  mocks.db.team.findUnique.mockResolvedValue(team());
  mocks.transaction.mockImplementation(async (work: (tx: typeof mocks.db) => unknown) => work(mocks.db));
});

describe("who may set it", () => {
  it.each([
    ["a gym", { id: "gym", role: "studio" }],
    ["a judge", { id: "j", role: "judge" }],
    ["BFT MENA in a read-only preview", { ...bft, viewAs: "someone" }],
  ])("not %s", async (_label, actor) => {
    mocks.requireAccess.mockResolvedValue(actor);
    expect(await setTeamOwnership({ teamId: "t1", ownership: "joint" })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("what it accepts", () => {
  it("a registrant needs a seat on this team, with an email", async () => {
    expect(await setTeamOwnership({ teamId: "t1", ownership: "registrant" })).toEqual({ ok: false, error: "SEAT_REQUIRED" });
    expect(await setTeamOwnership({ teamId: "t1", ownership: "registrant", registrantSeatId: "elsewhere" })).toEqual({ ok: false, error: "SEAT_NOT_ON_TEAM" });
    expect(await setTeamOwnership({ teamId: "t1", ownership: "registrant", registrantSeatId: "c" })).toEqual({ ok: false, error: "SEAT_HAS_NO_EMAIL" });
    expect(mocks.db.team.update).not.toHaveBeenCalled();
  });

  it("names the person in seat 2 by their email and account, under the competition lock — audited", async () => {
    expect(await setTeamOwnership({ teamId: "t1", ownership: "registrant", registrantSeatId: "a" })).toEqual({ ok: true });
    expect(mocks.db.$queryRaw).toHaveBeenCalled();
    expect(mocks.db.team.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { ownership: "registrant", registrantEmail: "mona@example.com", registrantUserId: "u-mona" } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ownership", detail: "unknown → registrant mona@example.com" }));
  });

  it("joint and unknown name nobody", async () => {
    mocks.db.team.findUnique.mockResolvedValue(team({ ownership: "registrant", registrantEmail: "mona@example.com", registrantUserId: "u-mona" }));
    await setTeamOwnership({ teamId: "t1", ownership: "joint" });
    expect(mocks.db.team.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { ownership: "joint", registrantEmail: null, registrantUserId: null } });
  });

  it("saving the same choice again writes and audits nothing", async () => {
    mocks.db.team.findUnique.mockResolvedValue(team({ ownership: "registrant", registrantEmail: "mona@example.com", registrantUserId: "u-mona" }));
    expect(await setTeamOwnership({ teamId: "t1", ownership: "registrant", registrantSeatId: "a" })).toEqual({ ok: true });
    expect(mocks.db.team.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
