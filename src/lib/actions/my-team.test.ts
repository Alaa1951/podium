/**
 * The registrant correcting their partner's NAME — and nothing that changes
 * who the partner is, in one request or in two, and nothing by anybody else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = { $queryRaw: vi.fn(), team: { findFirst: vi.fn() }, competitor: { update: vi.fn() } };
  return { tx, user: vi.fn(), transaction: vi.fn(), sync: vi.fn(), audit: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/security", () => ({ normalizeEmail: (s: string) => s.trim().toLowerCase() }));
vi.mock("@/lib/membership-sync", () => ({ syncAfterMembershipChange: mocks.sync }));
vi.mock("@/lib/audit", () => ({ recordAuditIn: mocks.audit, AUDIT: { teamPartnerCorrected: "corrected" } }));
vi.mock("@/lib/auth-proof", () => ({ PROOF_TX: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateMyTeam } from "./my-team";

const athlete = { id: "u-sara", role: "competitor", permissions: ["athleteHome.editTeam"] };
const FAR = new Date(Date.now() + 30 * 86_400_000);
/** Sara registered it and sits in seat 2; Mona (seat 1) has not signed in. */
let state: { email: string; fullName: string; phone: string | null };
const team = (over: object = {}) => ({
  id: "t1", number: 7, name: "FALCONS", membershipVersion: 3,
  ownership: "registrant", registrantEmail: "sara@example.com", registrantUserId: "u-sara",
  series: { status: "scheduled", competitionDate: FAR },
  competitors: [
    { id: "seat-mona", position: 1, userId: null, fullName: state.fullName, email: state.email },
    { id: "seat-sara", position: 2, userId: "u-sara", fullName: "Sara Ali", email: "sara@example.com" },
  ],
  ...over,
});
const mona = (fullName: string, email: string) => [{ position: 1, fullName, email }, { position: 2, fullName: "Sara Ali", email: "sara@example.com" }];

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.ATHLETE_MEMBERSHIP_CHANGES;
  state = { email: "mona@example.com", fullName: "Mona Saleh", phone: "+97450000001" };
  mocks.user.mockResolvedValue(athlete);
  mocks.tx.team.findFirst.mockImplementation(async () => team());
  // The seat as the database would hold it after each request.
  mocks.tx.competitor.update.mockImplementation(async ({ data }: { data: { fullName?: string; email?: string } }) => {
    if (data.fullName) state.fullName = data.fullName;
    if (data.email) state.email = data.email;
  });
  mocks.transaction.mockImplementation(async (work: (tx: typeof mocks.tx) => unknown) => work(mocks.tx));
});

describe("the email is who the partner is — never corrected here", () => {
  it("the review's two requests — the email, then the name — with membership changes off: the first is refused, so nobody is replaced", async () => {
    expect(await updateMyTeam(mona("Mona Saleh", "nour@example.com"), "s1", "t1", 3)).toEqual({ ok: false, error: "EMAIL_IS_A_NEW_PERSON" });
    expect(state.email).toBe("mona@example.com");
    expect(await updateMyTeam(mona("Nour Hassan", "mona@example.com"), "s1", "t1", 3)).toEqual({ ok: true });
    // The second request can only rename the SAME person (Mona's email, her seat).
    expect(state).toMatchObject({ email: "mona@example.com", fullName: "Nour Hassan" });
    expect(mocks.tx.competitor.update).toHaveBeenCalledTimes(1);
    expect(mocks.tx.competitor.update).toHaveBeenCalledWith({ where: { id: "seat-mona" }, data: { fullName: "Nour Hassan", normalizedName: expect.any(String) } });
  });

  it("with membership changes ON it is still refused here — Replace my partner is the one way", async () => {
    process.env.ATHLETE_MEMBERSHIP_CHANGES = "on";
    expect(await updateMyTeam(mona("Mona Saleh", "mona.s@example.com"), "s1", "t1", 3)).toEqual({ ok: false, error: "EMAIL_IS_A_NEW_PERSON" });
    expect(await updateMyTeam(mona("Nour Hassan", "nour@example.com"), "s1", "t1", 3)).toEqual({ ok: false, error: "EMAIL_IS_A_NEW_PERSON" });
    expect(mocks.tx.competitor.update).not.toHaveBeenCalled();
  });
});

describe("who may correct a name, and when", () => {
  it("nobody outside the team, without the athlete's key, or in a preview", async () => {
    mocks.tx.team.findFirst.mockResolvedValue(null);
    expect(await updateMyTeam(mona("Mona S.", "mona@example.com"), "s1", "t1")).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.tx.team.findFirst.mock.calls[0][0].where).toMatchObject({ id: "t1", seriesId: "s1", competitors: { some: { userId: "u-sara" } } });
    mocks.user.mockResolvedValue({ ...athlete, permissions: [] });
    expect(await updateMyTeam(mona("Mona S.", "mona@example.com"), "s1", "t1")).toEqual({ ok: false, error: "FORBIDDEN" });
    mocks.user.mockResolvedValue({ ...athlete, viewAs: {} });
    expect(await updateMyTeam(mona("Mona S.", "mona@example.com"), "s1", "t1")).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("not confirmed by BFT MENA: the only member signed in corrects the name; with both signed in, nobody", async () => {
    mocks.tx.team.findFirst.mockResolvedValue(team({ ownership: "unknown", registrantEmail: null, registrantUserId: null }));
    expect(await updateMyTeam(mona("Mona A. Saleh", "mona@example.com"), "s1", "t1", 3)).toEqual({ ok: true });
    expect(state.fullName).toBe("Mona A. Saleh");
    // The CRM payer comes first: Mona paid, so Sara is not the one who manages it.
    mocks.tx.team.findFirst.mockResolvedValue(team({ ownership: "unknown", registrantEmail: null, registrantUserId: null, source: "ghl", rawPayload: { email: "mona@example.com" } }));
    expect(await updateMyTeam(mona("Mona Saleh", "mona@example.com"), "s1", "t1", 3)).toEqual({ ok: false, error: "NOT_REGISTRANT" });
  });

  it("not the other member, and nobody when ownership is not confirmed and both have signed in", async () => {
    mocks.user.mockResolvedValue({ ...athlete, id: "u-mona" });
    mocks.tx.team.findFirst.mockResolvedValue(team({ registrantUserId: null, competitors: [
      { id: "seat-mona", position: 1, userId: "u-mona", fullName: "Mona Saleh", email: "mona@example.com" },
      { id: "seat-sara", position: 2, userId: null, fullName: "Sara Ali", email: "sara@example.com" },
    ] }));
    expect(await updateMyTeam([{ position: 1, fullName: "Mona Saleh", email: "mona@example.com" }, { position: 2, fullName: "Sara A.", email: "sara@example.com" }], "s1", "t1")).toEqual({ ok: false, error: "NOT_REGISTRANT" });
    mocks.user.mockResolvedValue(athlete);
    mocks.tx.team.findFirst.mockResolvedValue(team({ ownership: "unknown", registrantEmail: null, registrantUserId: null, competitors: [
      { id: "seat-mona", position: 1, userId: "u-mona", fullName: "Mona Saleh", email: "mona@example.com" },
      { id: "seat-sara", position: 2, userId: "u-sara", fullName: "Sara Ali", email: "sara@example.com" },
    ] }));
    expect(await updateMyTeam(mona("Mona S.", "mona@example.com"), "s1", "t1")).toEqual({ ok: false, error: "OWNERSHIP_UNKNOWN" });
  });

  it.each([
    ["one second before the cutoff", 24 * 3_600_000 + 1_000, { ok: true }],
    ["exactly at the cutoff", 24 * 3_600_000, { ok: false, error: "TEAM_EDIT_CLOSED" }],
    ["after the cutoff", 3_600_000, { ok: false, error: "TEAM_EDIT_CLOSED" }],
  ])("%s (the athlete is never Full access)", async (_label, msBeforeStart, expected) => {
    vi.useFakeTimers({ now: new Date("2026-10-01T12:00:00Z") });
    try {
      const start = new Date(Date.now() + (msBeforeStart as number));
      mocks.tx.team.findFirst.mockResolvedValue(team({ series: { status: "scheduled", competitionDate: start } }));
      expect(await updateMyTeam(mona("Mona A. Saleh", "mona@example.com"), "s1", "t1")).toEqual(expected);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a page opened before the team changed; a signed-in seat stays its account's", async () => {
    expect(await updateMyTeam(mona("Mona S.", "mona@example.com"), "s1", "t1", 2)).toEqual({ ok: false, error: "STALE_MEMBERSHIP" });
    expect(await updateMyTeam([{ position: 1, fullName: "Mona Saleh", email: "mona@example.com" }, { position: 2, fullName: "Sara Renamed", email: "sara@example.com" }], "s1", "t1")).toEqual({ ok: false, error: "SHARED_PROFILE" });
  });

  it("a name fix is audited in the same transaction; an audit failure fails it; an unchanged form writes nothing", async () => {
    expect(await updateMyTeam(mona("Mona A. Saleh", "mona@example.com"), "s1", "t1", 3)).toEqual({ ok: true });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "corrected" }));
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (work: (tx: typeof mocks.tx) => unknown) => work(mocks.tx));
    mocks.user.mockResolvedValue(athlete);
    mocks.tx.team.findFirst.mockImplementation(async () => team());
    expect(await updateMyTeam(mona(state.fullName, "mona@example.com"), "s1", "t1")).toEqual({ ok: true });
    expect(mocks.audit).not.toHaveBeenCalled();
    mocks.audit.mockRejectedValue(new Error("audit down"));
    await expect(updateMyTeam(mona("Mona B. Saleh", "mona@example.com"), "s1", "t1")).rejects.toThrow("audit down");
  });
});
