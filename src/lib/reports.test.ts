/**
 * The figures every competition screen reads, and the three ways they used to
 * be wrong.
 *
 * Each of these numbers appears in at least two places — a stat card, a menu
 * badge, a notice — so a disagreement between them does not look like a
 * miscount. It looks like a stale page, and somebody reloads instead of
 * reporting it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ teams: vi.fn(), people: vi.fn(), studios: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    team: { findMany: mocks.teams },
    competitor: { findMany: mocks.people },
    studio: { findMany: mocks.studios },
  },
}));

const { getSeriesReport } = await import("@/lib/reports");

/** Defaults are a paid team in the field, in a wave, not withdrawn. */
function team(over: Record<string, unknown> = {}) {
  return {
    id: "t",
    paymentStatus: "paid",
    waitlistedAt: null,
    attendedAt: null,
    amountMinor: 25000,
    currency: "QAR",
    source: "ghl",
    studioId: null,
    waveId: "w1",
    score: null,
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.people.mockResolvedValue([]);
  mocks.studios.mockResolvedValue([]);
  mocks.teams.mockResolvedValue([]);
});

describe("what the report is allowed to count", () => {
  // Withdrawn registrations were inside `registered`, `pending` and `inWave`,
  // while the roster screen the card LINKS TO filtered them out. The dashboard
  // and its own list disagreed, and neither said why.
  it("asks the database for live rows only, teams and people alike", async () => {
    await getSeriesReport("series-1");
    expect(mocks.teams).toHaveBeenCalledWith(
      expect.objectContaining({ where: { seriesId: "series-1", archivedAt: null } })
    );
    expect(mocks.people).toHaveBeenCalledWith(
      expect.objectContaining({ where: { team: { seriesId: "series-1", archivedAt: null } } })
    );
  });
});

describe("the field and the queue", () => {
  const roster = [
    team({ id: "paid-in-wave" }),
    team({ id: "owes-money", paymentStatus: "pending", waveId: null }),
    team({ id: "refunded", paymentStatus: "refunded", waveId: null }),
    team({ id: "waiting-unpaid", paymentStatus: "pending", waitlistedAt: new Date(), waveId: null }),
    team({ id: "waiting-paid", waitlistedAt: new Date(), waveId: null }),
  ];

  beforeEach(() => mocks.teams.mockResolvedValue(roster));

  it("counts everyone who entered as registered, waiting or not", async () => {
    const report = await getSeriesReport("series-1");
    // Entering is entering. The waiting list is about holding a PLACE.
    expect(report.registered).toBe(5);
    expect(report.waiting).toBe(2);
    expect(report.inField).toBe(3);
  });

  // THE ONE THAT MATTERS. "N teams are not in a wave" used to count waiting
  // entries, which are not supposed to have a wave — so once anybody was
  // waiting, the notice had a floor it could never go below and the Waves
  // badge stayed orange for good.
  it("measures waves against the field, so the number can reach zero", async () => {
    const report = await getSeriesReport("series-1");
    expect(report.inWave).toBe(1);
    expect(report.inField - report.inWave).toBe(2);

    mocks.teams.mockResolvedValue([
      team({ id: "placed" }),
      team({ id: "waiting", waitlistedAt: new Date(), waveId: null }),
    ]);
    const settled = await getSeriesReport("series-1");
    // Every field team has a wave. The waiting one must not hold it back.
    expect(settled.inField - settled.inWave).toBe(0);
  });

  // Money owed by somebody with no place is not money to chase: admitting
  // them is a separate decision, and `setWaitlist` says so out loud.
  it("chases payment only from teams that hold a place", async () => {
    const report = await getSeriesReport("series-1");
    expect(report.pending).toBe(1);
  });

  // A waiting entry is never competing, whatever its money says.
  it("keeps a paid waiting entry off the paid figure", async () => {
    const report = await getSeriesReport("series-1");
    expect(report.paid).toBe(1);
    expect(report.takingsMinor).toBe(25000);
  });

  // The invariant the new Waiting list card exists to explain: the difference
  // between "registered" and the three payment states IS the waiting list.
  it("leaves a gap in the payment states exactly the size of the queue", async () => {
    const report = await getSeriesReport("series-1");
    expect(report.registered - (report.paid + report.pending + report.refunded)).toBe(report.waiting);
  });
});
