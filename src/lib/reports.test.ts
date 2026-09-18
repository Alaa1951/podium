import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ aggregate: vi.fn(), first: vi.fn(), teams: vi.fn(), people: vi.fn(), studios: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  team: { aggregate: mocks.aggregate, findFirst: mocks.first, findMany: mocks.teams },
  competitor: { findMany: mocks.people }, studio: { findMany: mocks.studios },
} }));

import { getSeriesPaymentDefaults } from "@/lib/reports";

beforeEach(() => vi.resetAllMocks());

describe("detail payment defaults", () => {
  it("preserves the usual paid fee and currency without loading the competition roster", async () => {
    mocks.aggregate.mockResolvedValue({ _count: { _all: 4 }, _sum: { amountMinor: 100000 } });
    mocks.first.mockResolvedValue({ currency: "USD" });
    expect(await getSeriesPaymentDefaults("series-1")).toEqual({ paid: 4, takingsMinor: 100000, currency: "USD" });
    const where = { seriesId: "series-1", paymentStatus: "paid" };
    expect(mocks.aggregate).toHaveBeenCalledWith({ where, _count: { _all: true }, _sum: { amountMinor: true } });
    expect(mocks.first).toHaveBeenCalledWith({ where, select: { currency: true } });
    expect(mocks.teams).not.toHaveBeenCalled();
    expect(mocks.people).not.toHaveBeenCalled();
    expect(mocks.studios).not.toHaveBeenCalled();
  });

  it("keeps the empty-competition fallback", async () => {
    mocks.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { amountMinor: null } });
    mocks.first.mockResolvedValue(null);
    expect(await getSeriesPaymentDefaults("series-1")).toEqual({ paid: 0, takingsMinor: 0, currency: "QAR" });
  });
});
