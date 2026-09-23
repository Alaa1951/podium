/**
 * The number beside "Waiting list" in the menu.
 *
 * A badge that disagrees with the screen it opens does not read as a
 * miscount — it reads as a stale page, and the person reloads instead of
 * reporting it. So the two gates below are the whole subject of this file:
 * the CRM half belongs to BFT MENA, and it does not exist at all where the
 * sync is switched off.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ teams: vi.fn(), intake: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { team: { count: mocks.teams }, crmIntake: { count: mocks.intake } },
}));
vi.mock("@/lib/crm/sync", () => ({ crmSyncEnabled: mocks.enabled }));

const { countWaitingList, waitingTeamWhere } = await import("@/lib/waiting-list");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.teams.mockResolvedValue(2);
  mocks.intake.mockResolvedValue(31);
  mocks.enabled.mockReturnValue(true);
});

describe("waitingTeamWhere", () => {
  // One expression, read by the badge, the screen and the Overview. Written
  // out here so a change to any of the three has to change it deliberately.
  it("is the waiting, the live, and nothing else", () => {
    expect(waitingTeamWhere("series-1")).toEqual({
      seriesId: "series-1",
      archivedAt: null,
      waitlistedAt: { not: null },
    });
  });
});

describe("countWaitingList", () => {
  it("adds the queue to the unfinished registrations", async () => {
    await expect(countWaitingList("series-1", { includeIntake: true })).resolves.toEqual({
      teams: 2,
      intake: 31,
      total: 33,
    });
  });

  // THE ONE THAT MATTERS. The CRM half carries the emails and phone numbers
  // of people who have not finished registering; a studio never sees it. A
  // studio shown "33" beside a screen listing its own two entries has been
  // handed a bug, and would be right to report it as one.
  it("never counts the CRM half for somebody who cannot see it", async () => {
    await expect(countWaitingList("series-1", { includeIntake: false })).resolves.toEqual({
      teams: 2,
      intake: 0,
      total: 2,
    });
    expect(mocks.intake).not.toHaveBeenCalled();
  });

  // `crmIntakeFor` returns nothing when the sync is off, so counting the rows
  // anyway would put a number on a menu item whose screen is empty — on every
  // deployment that does not use the CRM at all.
  it("never counts rows the screen will not show, even for BFT MENA", async () => {
    mocks.enabled.mockReturnValue(false);
    await expect(countWaitingList("series-1", { includeIntake: true })).resolves.toEqual({
      teams: 2,
      intake: 0,
      total: 2,
    });
    expect(mocks.intake).not.toHaveBeenCalled();
  });

  it("carries the caller's scope into the team count", async () => {
    await countWaitingList("series-1", { includeIntake: true, scope: { studioId: "own" } });
    expect(mocks.teams).toHaveBeenCalledWith({
      where: {
        seriesId: "series-1",
        archivedAt: null,
        waitlistedAt: { not: null },
        studioId: "own",
      },
    });
  });
});
