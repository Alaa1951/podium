/**
 * The swap ACTION: who may call it, and that it hands the parsed request to
 * the one place that decides (staff-membership.ts › swapSeat, tested there
 * and on a real database).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAccess: vi.fn(), swap: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAccess: mocks.requireAccess }));
vi.mock("@/lib/prisma", () => ({ prisma: { tag: "client" } }));
vi.mock("@/lib/staff-membership", () => ({ swapSeat: mocks.swap }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: mocks.revalidate }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { swapTeamMember } from "@/lib/actions/team-swap";

const staff = { id: "admin-1", role: "admin", studioId: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(staff);
  mocks.swap.mockResolvedValue({ ok: true, message: "Nour Hassan now stands on team 7.", changed: true });
});

describe("the swap action", () => {
  it("needs the pairing permission and refuses a read-only preview", async () => {
    mocks.requireAccess.mockResolvedValue({ ...staff, viewAs: "someone" });
    expect(await swapTeamMember({ competitorId: "c1", fullName: "Nour Hassan" })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.requireAccess).toHaveBeenCalledWith("registrations.pair");
    expect(mocks.swap).not.toHaveBeenCalled();
  });

  it("asks for a name or an athlete, not nothing", async () => {
    expect(await swapTeamMember({ competitorId: "c1" })).toEqual({ ok: false, error: "NAME_REQUIRED" });
    expect(mocks.swap).not.toHaveBeenCalled();
  });

  it("passes the request — version and transfer included — to swapSeat, and refreshes the pages after a change", async () => {
    const result = await swapTeamMember({ competitorId: "c1", fullName: " Nour Hassan ", email: "nour@example.com", transferOwnership: true, expectedVersion: 4 });
    expect(result).toEqual({ ok: true, message: "Nour Hassan now stands on team 7." });
    expect(mocks.swap).toHaveBeenCalledWith({ tag: "client" }, staff, { competitorId: "c1", fullName: "Nour Hassan", email: "nour@example.com", transferOwnership: true, expectedVersion: 4 });
    expect(mocks.revalidate).toHaveBeenCalled();
  });

  it("returns the core's refusal as it is, and refreshes nothing", async () => {
    mocks.swap.mockResolvedValue({ ok: false, error: "STALE_MEMBERSHIP" });
    expect(await swapTeamMember({ competitorId: "c1", fullName: "Nour Hassan", expectedVersion: 3 })).toEqual({ ok: false, error: "STALE_MEMBERSHIP" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
