/**
 * Linking an account to its seats — only on a proven address, one seat per
 * competition per email (the payer's, when the address sits on both seats of
 * one team; none when it spans teams), never touching a partnership choice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // security.ts (reached through link-seats.ts) refuses to load without a secret.
  process.env.NEXTAUTH_SECRET ||= "test-secret-not-used-anywhere-real";
  return { reconcile: vi.fn() };
});
vi.mock("@/lib/membership-sync", () => ({ reconcileDerivedLinks: mocks.reconcile }));

import { linkSeatsForUser, payerSeatsToClaim } from "@/lib/link-seats";

const account = {
  id: "u1", email: "sara@example.com", role: "competitor", status: "active", archivedAt: null, approvalStatus: "approved", verifiedEmail: "sara@example.com",
};
const team = (seriesId: string, extra: Partial<{ id: string; paymentStatus: string; waitlistedAt: Date | null; competitors: { id: string }[]; series: { isTraining: boolean } }> = {}) => ({
  id: `t-${seriesId}`, seriesId, name: "FALCONS", createdAt: new Date("2026-09-01"), division: "Open", category: "Womens",
  paymentStatus: "paid", waitlistedAt: null, competitors: [{ id: "a" }, { id: "b" }], series: { isTraining: false }, ...extra,
});

type Seat = { id: string; userId: string | null; position?: number; team: { id: string; seriesId: string }; shirtSize?: string | null; bftMember?: boolean };

/**
 * A fake client whose $transaction runs the work against itself. The locking
 * read of the account answers with `user`; seat queries honour `userId: null`.
 */
function fakeDb(overrides: { user?: unknown; seats?: Seat[]; claimed?: number } = {}) {
  // A seat is the registrant's (position 1) unless a test says otherwise.
  const seats = (overrides.seats ?? []).map((seat) => ({ position: 1, ...seat }));
  const db = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockImplementation(async (strings: TemplateStringsArray) => (strings.join("?").includes("FROM User") ? [overrides.user ?? account] : [])),
    user: { findUnique: vi.fn().mockResolvedValue(overrides.user ?? account), update: vi.fn().mockResolvedValue(undefined) },
    competitor: {
      findMany: vi.fn().mockImplementation(async ({ where }: { where: { userId?: null } }) => (where.userId === null ? seats.filter((seat) => !seat.userId) : seats)),
      updateMany: vi.fn().mockResolvedValue({ count: overrides.claimed ?? 1 }),
      count: vi.fn().mockResolvedValue(seats.filter((seat) => !seat.userId).length),
    },
    seriesParticipant: { upsert: vi.fn().mockResolvedValue(undefined) },
  };
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
  return db;
}

const lockedSeries = (db: ReturnType<typeof fakeDb>) =>
  db.$queryRaw.mock.calls.filter(([strings]) => (strings as TemplateStringsArray).join("?").includes("FROM Series")).map(([, id]) => id);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reconcile.mockResolvedValue(undefined);
  delete process.env.ATHLETE_SEAT_LINKING;
});

describe("the seats an address stands for — the payer's", () => {
  const row = (id: string, position: number, teamId: string, seriesId = "s1") => ({ id, position, team: { id: teamId, seriesId } });

  it("its one seat, registrant or partner", () => {
    expect(payerSeatsToClaim([row("a", 1, "A")]).map((one) => one.id)).toEqual(["a"]);
    expect(payerSeatsToClaim([row("b", 2, "A")]).map((one) => one.id)).toEqual(["b"]);
  });

  it("on both seats of ONE team: the registrant's seat (position 1) only", () => {
    expect(payerSeatsToClaim([row("partner", 2, "A"), row("payer", 1, "A")]).map((one) => one.id)).toEqual(["payer"]);
  });

  it("across MORE THAN ONE team in a competition: nothing there — seat 1 and seat 1, or seat 1 and seat 2", () => {
    expect(payerSeatsToClaim([row("a", 1, "A"), row("b", 1, "B")])).toEqual([]);
    expect(payerSeatsToClaim([row("a", 1, "A"), row("b", 2, "B")])).toEqual([]);
  });

  it("decides each competition on its own", () => {
    const rows = [row("a", 1, "A", "s1"), row("b", 1, "B", "s1"), row("c", 2, "C", "s2"), row("d", 1, "C", "s2"), row("e", 2, "E", "s3")];
    expect(payerSeatsToClaim(rows).map((one) => one.id)).toEqual(["d", "e"]);
  });
});

describe("linking", () => {
  it("claims the seat, creates the participant row without touching an existing one, and corrects derived links", async () => {
    const db = fakeDb({ seats: [{ id: "c1", userId: null, shirtSize: "M", bftMember: true, team: team("s1") }] });
    const result = await linkSeatsForUser(db as never, "u1");
    expect(result).toEqual({ linked: 1, approved: false, skipped: null });
    expect(db.competitor.updateMany).toHaveBeenCalledWith({ where: { id: "c1", email: "sara@example.com", userId: null }, data: { userId: "u1" } });
    expect(db.seriesParticipant.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {}, create: expect.objectContaining({ lookingForPartner: false, teamName: "FALCONS" }) }));
    expect(mocks.reconcile).toHaveBeenCalledWith(db, "t-s1");
  });

  it("creates a solo entry's participant row still LOOKING for a partner", async () => {
    const db = fakeDb({ seats: [{ id: "c1", userId: null, shirtSize: null, bftMember: false, team: team("s1", { competitors: [{ id: "a" }] }) }] });
    await linkSeatsForUser(db as never, "u1");
    expect(db.seriesParticipant.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ lookingForPartner: true, teamName: null }) }));
  });

  it("approves a pending account once a proven, competing seat is linked — never a rejected one", async () => {
    const db = fakeDb({ user: { ...account, approvalStatus: "pending" }, seats: [{ id: "c1", userId: null, shirtSize: null, bftMember: false, team: team("s1") }] });
    expect(await linkSeatsForUser(db as never, "u1")).toMatchObject({ linked: 1, approved: true });
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvalStatus: "approved" }) }));

    const rejected = fakeDb({ user: { ...account, approvalStatus: "rejected" }, seats: [{ id: "c1", userId: null, shirtSize: null, bftMember: false, team: team("s1") }] });
    expect(await linkSeatsForUser(rejected as never, "u1")).toEqual({ linked: 0, approved: false, skipped: "rejected" });
    expect(rejected.competitor.updateMany).not.toHaveBeenCalled();
  });

  it("does not approve on an unpaid or waitlisted seat, but still links it (the entry is visible with its state)", async () => {
    const db = fakeDb({ user: { ...account, approvalStatus: "pending" }, seats: [{ id: "c1", userId: null, shirtSize: null, bftMember: false, team: team("s1", { paymentStatus: "pending" }) }] });
    expect(await linkSeatsForUser(db as never, "u1")).toEqual({ linked: 1, approved: false, skipped: null });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("links nothing for an unproven address, and reads the address from the row, not the caller", async () => {
    const db = fakeDb({ user: { ...account, verifiedEmail: null }, seats: [{ id: "c1", userId: null, team: team("s1") }] });
    expect(await linkSeatsForUser(db as never, "u1")).toEqual({ linked: 0, approved: false, skipped: "unproven" });
    const moved = fakeDb({ user: { ...account, email: "new@example.com", verifiedEmail: "sara@example.com" }, seats: [{ id: "c1", userId: null, team: team("s1") }] });
    expect(await linkSeatsForUser(moved as never, "u1")).toEqual({ linked: 0, approved: false, skipped: "unproven" });
    expect(moved.competitor.updateMany).not.toHaveBeenCalled();
  });

  it("links nothing for staff, invited, disabled or archived accounts", async () => {
    for (const bad of [{ role: "staff" }, { status: "invited" }, { status: "disabled" }, { archivedAt: new Date() }]) {
      const db = fakeDb({ user: { ...account, ...bad }, seats: [{ id: "c1", userId: null, team: team("s1") }] });
      expect((await linkSeatsForUser(db as never, "u1")).linked).toBe(0);
      expect(db.competitor.updateMany).not.toHaveBeenCalled();
    }
  });

  it("skips a competition where the address spans teams but links the clear one; never takes a seat somebody else holds", async () => {
    const db = fakeDb({
      seats: [
        { id: "a", userId: null, team: team("s1", { id: "t-A" }) },
        { id: "b", userId: null, position: 2, team: team("s1", { id: "t-B" }) },
        { id: "c", userId: "someone-else", team: team("s2") },
        { id: "d", userId: null, team: team("s3") },
      ],
    });
    expect(await linkSeatsForUser(db as never, "u1")).toMatchObject({ linked: 1 });
    expect(db.competitor.updateMany).toHaveBeenCalledTimes(1);
    expect(db.competitor.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "d" }) }));
  });

  it("is a no-op when a race already claimed the seat, and when nothing is left to claim", async () => {
    const raced = fakeDb({ seats: [{ id: "c1", userId: null, team: team("s1") }], claimed: 0 });
    expect(await linkSeatsForUser(raced as never, "u1")).toEqual({ linked: 0, approved: false, skipped: null });
    expect(raced.seriesParticipant.upsert).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();

    const linked = fakeDb({ seats: [{ id: "c1", userId: "u1", team: team("s1") }] });
    expect(await linkSeatsForUser(linked as never, "u1")).toEqual({ linked: 0, approved: false, skipped: null });
    expect(linked.competitor.updateMany).not.toHaveBeenCalled();
    // An ordinary sign-in takes no competition lock at all.
    expect(lockedSeries(linked)).toEqual([]);
  });

  it("locks each competition (in a fixed order) before claiming in it", async () => {
    const db = fakeDb({ seats: [{ id: "x", userId: null, team: team("s2") }, { id: "y", userId: null, team: team("s1") }] });
    await linkSeatsForUser(db as never, "u1");
    expect(lockedSeries(db)).toEqual(["s1", "s2"]);
    const lastLock = Math.max(...db.$queryRaw.mock.invocationCallOrder);
    expect(Math.min(...db.competitor.updateMany.mock.invocationCallOrder)).toBeGreaterThan(lastLock);
  });

  it("links a paid TRAINING seat but never approves on it", async () => {
    const db = fakeDb({ user: { ...account, approvalStatus: "pending" }, seats: [{ id: "c1", userId: null, team: team("s1", { series: { isTraining: true } }) }] });
    expect(await linkSeatsForUser(db as never, "u1")).toEqual({ linked: 1, approved: false, skipped: null });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("runs as ONE transaction of its own at READ COMMITTED — and opens none when there is nothing to claim", async () => {
    const db = fakeDb({ seats: [{ id: "c1", userId: null, team: team("s1") }] });
    expect(await linkSeatsForUser(db as never, "u1")).toMatchObject({ linked: 1 });
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "ReadCommitted" }));

    const idle = fakeDb({ seats: [{ id: "c1", userId: "u1", team: team("s1") }] });
    expect(await linkSeatsForUser(idle as never, "u1")).toEqual({ linked: 0, approved: false, skipped: null });
    expect(idle.$transaction).not.toHaveBeenCalled();
  });

  it("reports a failure halfway (the transaction rolled back whole) instead of throwing — the sign-in goes on", async () => {
    const db = fakeDb({ seats: [{ id: "c1", userId: null, team: team("s1") }] });
    db.$transaction.mockRejectedValue(new Error("participant insert failed"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await linkSeatsForUser(db as never, "u1")).toEqual({ linked: 0, approved: false, skipped: "failed" });
    error.mockRestore();
  });

  it("the payer's address on BOTH seats of their team claims the registrant's seat only — and they see their team", async () => {
    const db = fakeDb({ user: { ...account, approvalStatus: "pending" }, seats: [
      { id: "partner", userId: null, position: 2, team: team("s1") },
      { id: "payer", userId: null, position: 1, team: team("s1") },
    ] });
    expect(await linkSeatsForUser(db as never, "u1")).toEqual({ linked: 1, approved: true, skipped: null });
    expect(db.competitor.updateMany).toHaveBeenCalledTimes(1);
    expect(db.competitor.updateMany).toHaveBeenCalledWith({ where: { id: "payer", email: "sara@example.com", userId: null }, data: { userId: "u1" } });
    expect(mocks.reconcile).toHaveBeenCalledWith(db, "t-s1");

    // The partner's seat stays unclaimed for good — and the next sign-in opens no transaction for it.
    const after = fakeDb({ seats: [
      { id: "partner", userId: null, position: 2, team: team("s1") },
      { id: "payer", userId: "u1", position: 1, team: team("s1") },
    ] });
    expect(await linkSeatsForUser(after as never, "u1")).toEqual({ linked: 0, approved: false, skipped: null });
    expect(after.$transaction).not.toHaveBeenCalled();
  });

  it("an address on seats of two teams in one competition claims nothing there — seat 1 and seat 1, or seat 1 and seat 2", async () => {
    for (const other of [1, 2]) {
      const db = fakeDb({ user: { ...account, approvalStatus: "pending" }, seats: [
        { id: "a", userId: null, position: 1, team: team("s1", { id: "t-A" }) },
        { id: "b", userId: null, position: other, team: team("s1", { id: "t-B" }) },
      ] });
      expect(await linkSeatsForUser(db as never, "u1")).toEqual({ linked: 0, approved: false, skipped: null });
      expect(db.competitor.updateMany).not.toHaveBeenCalled();
      expect(db.user.update).not.toHaveBeenCalled();
    }
  });

  it("a partner seat with no email never counts: the payer claims their seat as always", async () => {
    // Seats are found BY address; a partner with none is simply not among them.
    const db = fakeDb({ seats: [{ id: "payer", userId: null, position: 1, team: team("s1", { competitors: [{ id: "payer" }, { id: "no-email" }] }) }] });
    expect(await linkSeatsForUser(db as never, "u1")).toMatchObject({ linked: 1 });
    expect(db.competitor.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "payer" }) }));
  });

  it("the payer's seat on an unpaid, waiting-list or training entry is linked and shown — and approves nothing", async () => {
    for (const extra of [{ paymentStatus: "pending" }, { waitlistedAt: new Date() }, { series: { isTraining: true } }]) {
      const db = fakeDb({ user: { ...account, approvalStatus: "pending" }, seats: [
        { id: "partner", userId: null, position: 2, team: team("s1", extra) },
        { id: "payer", userId: null, position: 1, team: team("s1", extra) },
      ] });
      expect(await linkSeatsForUser(db as never, "u1")).toEqual({ linked: 1, approved: false, skipped: null });
      expect(db.user.update).not.toHaveBeenCalled();
    }
  });

  it("can be switched off for a rollback without touching the proof rule", async () => {
    process.env.ATHLETE_SEAT_LINKING = "off";
    const db = fakeDb({ seats: [{ id: "c1", userId: null, team: team("s1") }] });
    expect(await linkSeatsForUser(db as never, "u1")).toEqual({ linked: 0, approved: false, skipped: null });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});
