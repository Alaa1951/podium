/**
 * Pairing two athletes into a team.
 *
 * The bracket written here decides the board AND the prescribed loads
 * (LoadStandard is keyed on [division, sex]), so the level and category are
 * checked against the two profiles rather than trusted from the form. The
 * other thing pinned here is the studio boundary, and the one deliberate hole
 * in it: a pair who chose each other across two studios.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  findSeries: vi.fn(),
  findAthletes: vi.fn(),
  findCompetitor: vi.fn(),
  findTeam: vi.fn(),
  createTeam: vi.fn(),
  linkPair: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
  registrationOpen: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAccess: mocks.requireAccess,
  isBft: (u: { role: string }) => u.role === "admin" || u.role === "staff",
  isStudio: (u: { role: string }) => u.role === "studio",
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    series: { findFirst: mocks.findSeries },
    user: { findMany: mocks.findAthletes },
    seriesParticipant: { findMany: async () => (await mocks.findAthletes()).map((a: { id: string; athleteProfile: object }) => ({ userId: a.id, ...a.athleteProfile })) },
    competitor: { findFirst: mocks.findCompetitor },
    team: { create: mocks.createTeam, findFirst: mocks.findTeam },
  },
}));
vi.mock("@/lib/partners", () => ({ linkPair: mocks.linkPair }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.audit, AUDIT: { registrationCreated: "r" } }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: mocks.revalidate }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/visibility", () => ({ registrationOpen: mocks.registrationOpen }));
vi.mock("@/lib/scoring", () => ({ normalizeName: (n: string) => n.toLowerCase() }));

vi.mock("@/lib/participation", () => ({ ensureParticipation: vi.fn(), loadSeriesAthlete: async (id: string) => (await mocks.findAthletes()).find((a: { id: string }) => a.id === id) }));
vi.mock("@/lib/team-create", () => ({ createTeam: mocks.createTeam }));

import { pairAthletes } from "@/lib/actions/pairing";

const studio = { id: "s1", role: "studio", studioId: "studio-a", email: "gym@example.com" };

function athlete(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    phone: null,
    studioId: "studio-a",
    athleteProfile: {
      dateOfBirth: null,
      partnerUserId: null,
      division: "Open",
      category: "Womens",
      sex: "f",
      shirtSize: "M",
      bftMember: false,
      ...(over.athleteProfile as object),
    },
    ...over,
  };
}

const input = {
  seriesId: "series-1",
  athleteIds: ["a", "b"] as [string, string],
  division: "Open",
  category: "Womens",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAccess.mockResolvedValue(studio);
  mocks.registrationOpen.mockReturnValue({ open: true });
  mocks.findSeries.mockResolvedValue({ id: "series-1", registrationClosesAt: null, status: "scheduled" });
  mocks.findAthletes.mockResolvedValue([athlete("a"), athlete("b")]);
  mocks.findCompetitor.mockResolvedValue(null);
  mocks.findTeam.mockResolvedValue({ number: 100 });
  mocks.createTeam.mockResolvedValue({ ok: true, id: "t1", number: 101, name: "A" });
  mocks.audit.mockResolvedValue(undefined);
  mocks.linkPair.mockResolvedValue(undefined);
});

describe("the bracket is checked, not trusted", () => {
  it("refuses two athletes who compete at different levels", async () => {
    mocks.findAthletes.mockResolvedValue([
      athlete("a", { athleteProfile: { division: "Rookie" } }),
      athlete("b", { athleteProfile: { division: "Pro" } }),
    ]);
    expect(await pairAthletes(input)).toEqual({ ok: false, error: "MIXED_LEVELS" });
    expect(mocks.createTeam).not.toHaveBeenCalled();
  });

  it("refuses a level the form submitted that is not theirs", async () => {
    expect(await pairAthletes({ ...input, division: "Pro" })).toEqual({
      ok: false,
      error: "LEVEL_MISMATCH",
    });
  });

  it("refuses a Womens entry when one of them is male", async () => {
    mocks.findAthletes.mockResolvedValue([athlete("a"), athlete("b", { athleteProfile: { sex: "m" } })]);
    expect(await pairAthletes(input)).toEqual({ ok: false, error: "CATEGORY_MISMATCH" });
  });

  it("allows Mixed whatever the two are — a pair may compete up", async () => {
    mocks.findAthletes.mockResolvedValue([athlete("a"), athlete("b", { athleteProfile: { sex: "m" } })]);
    expect(await pairAthletes({ ...input, category: "Mixed" })).toMatchObject({ ok: true });
  });
});

describe("the studio boundary", () => {
  it("refuses a studio pairing somebody else's athlete", async () => {
    mocks.findAthletes.mockResolvedValue([athlete("a"), athlete("b", { studioId: "studio-b" })]);
    expect(await pairAthletes(input)).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("lets a studio enter a cross-studio pair who chose each other", async () => {
    mocks.findAthletes.mockResolvedValue([
      athlete("a", { athleteProfile: { partnerUserId: "b" } }),
      athlete("b", { studioId: "studio-b", athleteProfile: { partnerUserId: "a" } }),
    ]);
    // Without this the pair would be a team nobody could enter: not this
    // studio, not the other one.
    expect(await pairAthletes(input)).toMatchObject({ ok: true });
  });

  it("still refuses two athletes of another studio, linked or not", async () => {
    mocks.findAthletes.mockResolvedValue([
      athlete("a", { studioId: "studio-b", athleteProfile: { partnerUserId: "b" } }),
      athlete("b", { studioId: "studio-b", athleteProfile: { partnerUserId: "a" } }),
    ]);
    expect(await pairAthletes(input)).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});

describe("the rest of the guards", () => {
  it("refuses a view-as preview", async () => {
    mocks.requireAccess.mockResolvedValue({ ...studio, viewAs: { byAdminId: "boss" } });
    expect(await pairAthletes(input)).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("refuses the same person twice", async () => {
    expect(await pairAthletes({ ...input, athleteIds: ["a", "a"] })).toEqual({
      ok: false,
      error: "SAME_ATHLETE",
    });
  });

  it("refuses once registration has closed", async () => {
    mocks.registrationOpen.mockReturnValue({ open: false, reason: "REGISTRATION_CLOSED" });
    expect(await pairAthletes(input)).toEqual({ ok: false, error: "REGISTRATION_CLOSED" });
  });

  it("refuses somebody already partnered with a third person", async () => {
    mocks.findAthletes.mockResolvedValue([
      athlete("a", { athleteProfile: { partnerUserId: "someone-else" } }),
      athlete("b"),
    ]);
    expect(await pairAthletes(input)).toEqual({ ok: false, error: "HAS_OTHER_PARTNER" });
  });

  it("refuses somebody already entered in this competition", async () => {
    mocks.findCompetitor.mockResolvedValue({ id: "c1" });
    expect(await pairAthletes(input)).toEqual({ ok: false, error: "ALREADY_ENTERED" });
  });
});

describe("what the team carries", () => {
  it("copies the shirt size and membership onto each seat", async () => {
    await pairAthletes(input);
    const seats = mocks.createTeam.mock.calls[0][1].seats;
    expect(seats).toHaveLength(2);
    for (const seat of seats) expect(seat).toMatchObject({ shirtSize: "M", bftMember: false });
  });

  it("passes both shared identities to the atomic team writer", async () => {
    await pairAthletes(input);
    expect(mocks.createTeam.mock.calls[0][1].seats.map((s: { userId: string }) => s.userId)).toEqual(["a", "b"]);
  });
});
