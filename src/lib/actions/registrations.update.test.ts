/**
 * The registration-edit ACTION: who may call it, and that the form reaches
 * the one place that decides (staff-membership.ts › editRegistration, tested
 * there and on a real database) with seat ids, dates and the page's version.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAccess: vi.fn(), edit: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAccess: mocks.requireAccess, isBft: () => true, teamScope: () => ({}) }));
vi.mock("@/lib/prisma", () => ({ prisma: { tag: "client" } }));
vi.mock("@/lib/staff-membership", () => ({ editRegistration: mocks.edit }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: mocks.revalidate }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(), AUDIT: {} }));
vi.mock("@/lib/one-entry", () => ({ alreadyEntered: vi.fn() }));
vi.mock("@/lib/team-create", () => ({ createTeam: vi.fn() }));

import { updateRegistration } from "@/lib/actions/registrations";

const bft = { id: "hq", role: "admin", studioId: null };
const person = (fullName: string, email: string, id?: string) => ({ ...(id ? { id } : {}), fullName, email, phone: "", dateOfBirth: "1990-02-03", studioId: "" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(bft);
  mocks.edit.mockResolvedValue({ ok: true });
});

describe("the registration-edit action", () => {
  it("refuses a read-only preview and a malformed form, without deciding anything", async () => {
    mocks.requireAccess.mockResolvedValue({ ...bft, viewAs: "x" });
    expect(await updateRegistration({ teamId: "t1", teamName: "Falcons", category: "Womens", division: "Open", one: person("Sara Ali", "sara@example.com") })).toEqual({ ok: false, error: "FORBIDDEN" });
    mocks.requireAccess.mockResolvedValue(bft);
    expect(await updateRegistration({ teamId: "t1", teamName: "", category: "Womens", division: "Open", one: person("Sara Ali", "sara@example.com") })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(mocks.edit).not.toHaveBeenCalled();
  });

  it("sends one seat or two, with their ids, parsed dates and the page's version", async () => {
    await updateRegistration({ teamId: "t1", teamName: "Falcons", category: "Womens", division: "Open", one: person("Sara Ali", "sara@example.com", "seat-b"), two: person("Mona Saleh", "mona@example.com"), expectedVersion: 4 });
    const [client, actor, input] = mocks.edit.mock.calls[0];
    expect(client).toEqual({ tag: "client" });
    expect(actor).toBe(bft);
    expect(input).toMatchObject({ teamId: "t1", expectedVersion: 4, one: { id: "seat-b", fullName: "Sara Ali", email: "sara@example.com" }, two: { fullName: "Mona Saleh" } });
    expect(input.one.dateOfBirth).toBeInstanceOf(Date);
    expect(input.two).not.toHaveProperty("id");

    await updateRegistration({ teamId: "t1", teamName: "Falcons", category: "Womens", division: "Open", one: person("Sara Ali", "sara@example.com", "seat-b") });
    expect(mocks.edit.mock.calls[1][2]).not.toHaveProperty("two");
  });

  it("returns the core's refusal unchanged, and refreshes only after a change", async () => {
    mocks.edit.mockResolvedValue({ ok: false, error: "PERSON_CHANGED" });
    expect(await updateRegistration({ teamId: "t1", teamName: "Falcons", category: "Womens", division: "Open", one: person("Nour Hassan", "nour@example.com", "seat-b") })).toEqual({ ok: false, error: "PERSON_CHANGED" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
