/**
 * Asking for a competitor's code — the door that used to carry linking and
 * approval with it, and no longer does.
 *
 * Asking proves nothing: anyone can type an address. So this door only
 * decides whether a code goes out (a competing entry, or a signed-up
 * athlete's account) and mints the `invited` row the code will be checked
 * against. Nothing is linked, activated or approved here; that happens when
 * the code is typed (auth-proof.ts → link-seats.ts), against the address the
 * code went to. The load-bearing tests: the waiting list is not a way in,
 * nothing is approved or linked at request time, and a stranger learns
 * nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findCompetitors: vi.fn(),
  findUser: vi.fn(),
  updateUser: vi.fn(),
  createUser: vi.fn(),
  linkCompetitors: vi.fn(),
  otp: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    seriesParticipant: { upsert: vi.fn() },
    competitor: { findMany: mocks.findCompetitors, updateMany: mocks.linkCompetitors },
    user: { findUnique: mocks.findUser, update: mocks.updateUser, create: mocks.createUser },
  },
}));
vi.mock("@/lib/otp", () => ({ createOtpChallenge: mocks.otp }));
vi.mock("@/lib/security", () => ({ normalizeEmail: (e: string) => e.trim().toLowerCase() }));

import { issueCompetitorCode } from "@/lib/competitor-access";

const WAITING = new Date("2026-09-21T10:00:00Z");

/** One registration of Sara's — the registrant's seat unless said — with the team facts the gate reads. */
function entry(team: { paymentStatus: string; waitlistedAt?: Date | null; id?: string }, position = 1) {
  return {
    id: "c1",
    fullName: "Sara Ali",
    userId: null,
    position,
    team: {
      id: team.id ?? "t1",
      seriesId: "s1",
      name: "FALCONS",
      paymentStatus: team.paymentStatus,
      waitlistedAt: team.waitlistedAt ?? null,
      series: { id: "s1", name: "PODIUM 4", slug: "podium-4", status: "scheduled" },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.otp.mockResolvedValue({ code: "123456" });
  mocks.findUser.mockResolvedValue(null);
  mocks.createUser.mockResolvedValue({ id: "u-sara", email: "sara@example.com", role: "competitor", status: "invited" });
});

describe("a place in the field", () => {
  it("sends a paid competitor a code, minting an invited account the code will be checked against", async () => {
    mocks.findCompetitors.mockResolvedValue([entry({ paymentStatus: "paid" })]);
    expect(await issueCompetitorCode("Sara@Example.com")).toEqual({ ok: true, code: "123456", name: "Sara Ali" });
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "sara@example.com", role: "competitor", status: "invited" }) })
    );
    // The code records the address it goes to — that is what it will prove.
    expect(mocks.otp).toHaveBeenCalledWith({ userId: "u-sara", purpose: "login", sentTo: "sara@example.com" });
  });

  it("neither links a seat nor approves an account when a code is merely ASKED for", async () => {
    mocks.findCompetitors.mockResolvedValue([entry({ paymentStatus: "paid" })]);
    mocks.findUser.mockResolvedValue({ id: "u-sara", email: "sara@example.com", role: "competitor", status: "active", approvalStatus: "pending" });
    await issueCompetitorCode("sara@example.com");
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.linkCompetitors).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("does not mint an account for an address that already belongs to staff", async () => {
    mocks.findCompetitors.mockResolvedValue([entry({ paymentStatus: "paid" })]);
    mocks.findUser.mockResolvedValue({ id: "u-staff", email: "sara@example.com", role: "staff", status: "active" });
    expect(await issueCompetitorCode("sara@example.com")).toEqual({ ok: false });
    expect(mocks.otp).not.toHaveBeenCalled();
  });
});

describe("training payments", () => {
  it("does not open the paid door for a rehearsal team — the signed-up athlete's own code still goes out", async () => {
    const rehearsal = entry({ paymentStatus: "paid" });
    mocks.findCompetitors.mockResolvedValue([{ ...rehearsal, team: { ...rehearsal.team, series: { ...rehearsal.team.series, isTraining: true } } }]);
    mocks.findUser.mockResolvedValue({ id: "u-sara", email: "sara@example.com", name: "Sara", role: "competitor", status: "active", signupType: "athlete", archivedAt: null });
    expect(await issueCompetitorCode("sara@example.com")).toMatchObject({ ok: true });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.otp).toHaveBeenCalledWith(expect.objectContaining({ sentTo: "sara@example.com" }));
  });
});

describe("shared contact email on imported rosters", () => {
  it("does not turn different athletes sharing one event email into one account — seats of two teams in one competition", async () => {
    const first = entry({ paymentStatus: "paid" });
    mocks.findCompetitors.mockResolvedValue([first, { ...entry({ paymentStatus: "paid", id: "t2" }), id: "c2", fullName: "Another athlete" }]);
    // No account is minted; the mailbox is pointed at Sign up (never the screen).
    expect(await issueCompetitorCode("shared@example.com")).toEqual({ ok: false, signup: true });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.otp).not.toHaveBeenCalled();
  });

  it("still opens the door on the unambiguous competition when another is shared", async () => {
    const first = entry({ paymentStatus: "paid" });
    const next = { ...first, id: "c-next", team: { ...first.team, seriesId: "s2", series: { ...first.team.series, id: "s2" } } };
    mocks.findCompetitors.mockResolvedValue([first, { ...entry({ paymentStatus: "paid", id: "t2" }), id: "c2" }, next]);
    expect(await issueCompetitorCode("sara@example.com")).toMatchObject({ ok: true });
  });

  it("opens the door for the payer whose address is on BOTH seats of their team — the account is theirs, the registrant's", async () => {
    const payer = entry({ paymentStatus: "paid" });
    const partner = { ...entry({ paymentStatus: "paid" }, 2), id: "c2", fullName: "Mona Saleh" };
    mocks.findCompetitors.mockResolvedValue([partner, payer]);
    expect(await issueCompetitorCode("sara@example.com")).toEqual({ ok: true, code: "123456", name: "Sara Ali" });
    expect(mocks.createUser).toHaveBeenCalledWith({ data: expect.objectContaining({ email: "sara@example.com", name: "Sara Ali", status: "invited" }) });
    // Minted, never linked or approved at request time.
    expect(mocks.linkCompetitors).not.toHaveBeenCalled();
  });

  it("still points an address spanning two teams at Sign up, whichever seats it holds", async () => {
    for (const position of [1, 2]) {
      mocks.findCompetitors.mockResolvedValue([entry({ paymentStatus: "paid" }), { ...entry({ paymentStatus: "paid", id: "t2" }, position), id: "c2" }]);
      expect(await issueCompetitorCode("coach@example.com")).toEqual({ ok: false, signup: true });
    }
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});

describe("the waiting list", () => {
  it("does NOT treat a paid waitlisted entry as a competitor", async () => {
    // Money must not be how somebody joins a full competition. They fall
    // through to the signed-up-athlete door instead.
    mocks.findCompetitors.mockResolvedValue([entry({ paymentStatus: "paid", waitlistedAt: WAITING })]);
    mocks.findUser.mockResolvedValue({ id: "u-sara", email: "sara@example.com", name: "Sara Ali", role: "competitor", status: "active", signupType: "athlete", archivedAt: null });
    expect(await issueCompetitorCode("sara@example.com")).toEqual({ ok: true, code: "123456", name: "Sara Ali" });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("picks the entry that holds a place when somebody has both (in two competitions)", async () => {
    const holding = entry({ paymentStatus: "paid", id: "t2" });
    mocks.findCompetitors.mockResolvedValue([entry({ paymentStatus: "paid", waitlistedAt: WAITING }), { ...holding, id: "c2", team: { ...holding.team, seriesId: "s2" } }]);
    expect(await issueCompetitorCode("sara@example.com")).toMatchObject({ ok: true });
    expect(mocks.createUser).toHaveBeenCalled();
  });
});

describe("what a stranger learns", () => {
  it("says nothing at all for an address that never competed and never signed up", async () => {
    mocks.findCompetitors.mockResolvedValue([]);
    expect(await issueCompetitorCode("nobody@example.com")).toEqual({ ok: false });
  });

  it("refuses a disabled or archived account rather than mailing it a code", async () => {
    mocks.findCompetitors.mockResolvedValue([entry({ paymentStatus: "paid" })]);
    mocks.findUser.mockResolvedValue({ id: "u-sara", role: "competitor", status: "disabled" });
    expect(await issueCompetitorCode("sara@example.com")).toEqual({ ok: false });
    mocks.findUser.mockResolvedValue({ id: "u-sara", role: "competitor", status: "active", archivedAt: new Date() });
    expect(await issueCompetitorCode("sara@example.com")).toEqual({ ok: false });
    expect(mocks.otp).not.toHaveBeenCalled();
  });

  it("does not mint an account from an unpaid registration — it points the mailbox at Sign up instead", async () => {
    mocks.findCompetitors.mockResolvedValue([entry({ paymentStatus: "pending" })]);
    expect(await issueCompetitorCode("sara@example.com")).toEqual({ ok: false, signup: true });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.otp).not.toHaveBeenCalled();
  });
});

describe("a way in for every athlete account, and for every seat holder", () => {
  it.each([
    ["waiting list", entry({ paymentStatus: "paid", waitlistedAt: WAITING })],
    ["training", { ...entry({ paymentStatus: "paid" }), team: { ...entry({ paymentStatus: "paid" }).team, series: { ...entry({ paymentStatus: "paid" }).team.series, isTraining: true } } }],
    ["unpaid", entry({ paymentStatus: "pending" })],
  ])("a %s seat with NO account: no account minted, no code, the owner is sent to Sign up", async (_label, seat) => {
    mocks.findCompetitors.mockResolvedValue([seat]);
    expect(await issueCompetitorCode("sara@example.com")).toEqual({ ok: false, signup: true });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("sends a code to ANY athlete account — no password, no sign-up record, no competing entry — and approves nothing", async () => {
    // A code-only athlete, or one minted from a seat that has since been
    // refunded: the code is still their way in.
    mocks.findCompetitors.mockResolvedValue([entry({ paymentStatus: "refunded" })]);
    mocks.findUser.mockResolvedValue({ id: "u-sara", email: "sara@example.com", name: "Sara", role: "competitor", status: "active", signupType: null, archivedAt: null });
    expect(await issueCompetitorCode("sara@example.com")).toEqual({ ok: true, code: "123456", name: "Sara" });
    expect(mocks.otp).toHaveBeenCalledWith({ userId: "u-sara", purpose: "login", sentTo: "sara@example.com" });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.linkCompetitors).not.toHaveBeenCalled();

    mocks.findCompetitors.mockResolvedValue([]);
    mocks.findUser.mockResolvedValue({ id: "u-new", email: "new@example.com", name: null, role: "competitor", status: "invited", signupType: "athlete", archivedAt: null });
    expect(await issueCompetitorCode("new@example.com")).toMatchObject({ ok: true });
  });
});
