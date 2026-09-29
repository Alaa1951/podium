/**
 * Correcting a registration — with one seat or two, and without letting a gym
 * change who registered the team.
 *
 * Pinned here:
 *   · a team may have ONE seat (a CRM contact with no partner yet), whatever
 *     its position; editing it updates that seat, never invents another;
 *   · "Add partner" creates the second seat at the FREE position;
 *   · the registrant's email is an identity: only BFT MENA changes it, and
 *     when they do the team's registrant follows in the same transaction.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "s1" }]),
    team: { update: vi.fn() },
    competitor: { update: vi.fn(), create: vi.fn() },
  };
  return {
    db,
    requireAccess: vi.fn(),
    findTeam: vi.fn(),
    transaction: vi.fn(),
    audit: vi.fn(),
  };
});

vi.mock("@/lib/session", () => ({
  requireAccess: mocks.requireAccess,
  isBft: (u: { role: string }) => u.role === "admin" || u.role === "staff",
  teamScope: () => ({}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { team: { findFirst: mocks.findTeam }, $transaction: mocks.transaction } }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.audit, AUDIT: { registrationUpdated: "updated", teamOwnershipChanged: "ownership" } }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: vi.fn() }));
vi.mock("@/lib/one-entry", () => ({ alreadyEntered: vi.fn() }));
vi.mock("@/lib/team-create", () => ({ createTeam: vi.fn() }));
vi.mock("@/lib/scoring", () => ({ normalizeName: (n: string) => n.toLowerCase() }));
vi.mock("@/lib/visibility", () => ({ registrationOpen: () => ({ open: true }) }));

import { updateRegistration } from "@/lib/actions/registrations";

const bft = { id: "hq", role: "admin", studioId: null };
const gym = { id: "gym", role: "studio", studioId: "studio-a" };

const person = (fullName: string, email: string, id?: string) => ({ ...(id ? { id } : {}), fullName, email, phone: "", dateOfBirth: "", studioId: "" });
const form = (one: object, two?: object) => ({ teamId: "t1", teamName: "Falcons", category: "Womens", division: "Open", one, ...(two ? { two } : {}) });

/** Team t1 with the given seats, and Sara (whichever seat she has) as registrant by default. */
function team(competitors: { id: string; position: number; email: string | null; userId?: string | null }[], owner: object = {}) {
  return {
    id: "t1", seriesId: "s1", number: 7, name: "FALCONS", division: "Open",
    ownership: "registrant", registrantEmail: "sara@example.com", registrantUserId: null,
    series: { registrationClosesAt: null },
    competitors: competitors.map((seat) => ({ userId: null, ...seat })),
    ...owner,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(bft);
  mocks.transaction.mockImplementation(async (work: (tx: typeof mocks.db) => unknown) => work(mocks.db));
});

describe("a team with one seat", () => {
  it("edits THAT seat — even when it sits at position 2 — and creates nothing", async () => {
    mocks.findTeam.mockResolvedValue(team([{ id: "seat-b", position: 2, email: "sara@example.com" }]));
    expect(await updateRegistration(form(person("Sara Ali", "sara@example.com", "seat-b")))).toMatchObject({ ok: true });
    expect(mocks.db.competitor.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "seat-b" } }));
    expect(mocks.db.competitor.create).not.toHaveBeenCalled();
  });

  it("an older form without seat ids still edits the one seat there is", async () => {
    mocks.findTeam.mockResolvedValue(team([{ id: "seat-b", position: 2, email: "sara@example.com" }]));
    await updateRegistration(form(person("Sara Ali", "sara@example.com")));
    expect(mocks.db.competitor.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "seat-b" } }));
    expect(mocks.db.competitor.create).not.toHaveBeenCalled();
  });

  it("Add partner: the new seat goes to the FREE position, under the competition lock", async () => {
    mocks.findTeam.mockResolvedValue(team([{ id: "seat-b", position: 2, email: "sara@example.com" }]));
    await updateRegistration(form(person("Sara Ali", "sara@example.com", "seat-b"), person("Mona Saleh", "mona@example.com")));
    expect(mocks.db.$queryRaw).toHaveBeenCalled();
    expect(mocks.db.competitor.create).toHaveBeenCalledWith({ data: expect.objectContaining({ teamId: "t1", position: 1, fullName: "Mona Saleh" }) });
  });
});

describe("what the form may not do", () => {
  it("refuses a seat id that is not on this team, and a third person", async () => {
    mocks.findTeam.mockResolvedValue(team([{ id: "seat-a", position: 1, email: "sara@example.com" }, { id: "seat-b", position: 2, email: "mona@example.com" }]));
    expect(await updateRegistration(form(person("X Y", "x@example.com", "someone-elses-seat")))).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await updateRegistration(form(person("Sara Ali", "sara@example.com", "seat-a"), person("New Person", "new@example.com")))).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("the registrant's email", () => {
  const full = (owner: object = {}) =>
    team([{ id: "seat-a", position: 1, email: "sara@example.com" }, { id: "seat-b", position: 2, email: "mona@example.com" }], owner);

  it("a gym cannot change it — wherever the registrant sits", async () => {
    mocks.requireAccess.mockResolvedValue(gym);
    mocks.findTeam.mockResolvedValue(full());
    expect(await updateRegistration(form(person("Sara Ali", "sara.new@example.com", "seat-a"), person("Mona Saleh", "mona@example.com", "seat-b")))).toEqual({ ok: false, error: "REGISTRANT_EMAIL_LOCKED" });

    mocks.findTeam.mockResolvedValue(full({ registrantEmail: "mona@example.com" }));
    expect(await updateRegistration(form(person("Sara Ali", "sara@example.com", "seat-a"), person("Mona Saleh", "mona.new@example.com", "seat-b")))).toEqual({ ok: false, error: "REGISTRANT_EMAIL_LOCKED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("a gym may still correct everything else, including the OTHER member's email", async () => {
    mocks.requireAccess.mockResolvedValue(gym);
    mocks.findTeam.mockResolvedValue(full());
    expect(await updateRegistration(form(person("Sara A. Ali", "sara@example.com", "seat-a"), person("Mona Saleh", "mona.new@example.com", "seat-b")))).toMatchObject({ ok: true });
    expect(mocks.db.team.update).toHaveBeenCalledTimes(1); // the name/category update only
  });

  it("BFT MENA changes it, and the team's registrant follows in the same transaction — audited", async () => {
    mocks.findTeam.mockResolvedValue(full({ registrantUserId: "u-sara" }));
    expect(await updateRegistration(form(person("Sara Ali", "Sara.New@Example.com", "seat-a"), person("Mona Saleh", "mona@example.com", "seat-b")))).toMatchObject({ ok: true });
    expect(mocks.db.team.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { registrantEmail: "sara.new@example.com", registrantUserId: null } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ownership" }));
  });
});
