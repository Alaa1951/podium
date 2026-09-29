/**
 * Who registered a team: a person, found by account or email — never by seat
 * position — and nobody at all when it is not confirmed.
 */
import { describe, expect, it } from "vitest";

import { incompleteTeamPolicyEnabled, isComplete, isEligibleToCompete, membershipChangesEnabled, membershipDoor, membershipRights, onTheFloor, ownershipFromContact, registrantSeat, TEAM_CHANGES_CLOSE_HOURS, teamChangeWindow, teamChangesCloseAt, teamChangesCloseLabel } from "@/lib/ownership";

const seats = [
  { id: "a", userId: "u-mona", email: "mona@example.com" },
  { id: "b", userId: null, email: "Sara@Example.com" },
];

describe("the registrant's seat", () => {
  it("is found by account first, then by email — in seat 1 or seat 2 alike", () => {
    expect(registrantSeat({ ownership: "registrant", registrantUserId: "u-mona", registrantEmail: "other@example.com", competitors: seats })?.id).toBe("a");
    expect(registrantSeat({ ownership: "registrant", registrantUserId: null, registrantEmail: "sara@example.com", competitors: seats })?.id).toBe("b");
  });

  it("is nobody for joint or unknown ownership, for an email on no seat, or on both", () => {
    expect(registrantSeat({ ownership: "joint", registrantUserId: null, registrantEmail: "sara@example.com", competitors: seats })).toBeNull();
    expect(registrantSeat({ ownership: "unknown", registrantUserId: null, registrantEmail: "sara@example.com", competitors: seats })).toBeNull();
    expect(registrantSeat({ ownership: "registrant", registrantUserId: null, registrantEmail: "gone@example.com", competitors: seats })).toBeNull();
    const twice = [seats[1], { ...seats[1], id: "c" }];
    expect(registrantSeat({ ownership: "registrant", registrantUserId: null, registrantEmail: "sara@example.com", competitors: twice })).toBeNull();
  });
});

describe("ownership from a CRM contact", () => {
  it("the payer on one seat registered the team; anything else is unknown", () => {
    expect(ownershipFromContact(" Sara@Example.com ", ["mona@example.com", "sara@example.com"])).toEqual({ ownership: "registrant", registrantEmail: "sara@example.com" });
    expect(ownershipFromContact("payer@example.com", ["mona@example.com", "sara@example.com"])).toEqual({ ownership: "unknown", registrantEmail: null });
    expect(ownershipFromContact(null, ["mona@example.com"])).toEqual({ ownership: "unknown", registrantEmail: null });
    expect(ownershipFromContact("sara@example.com", ["sara@example.com", "SARA@example.com"])).toEqual({ ownership: "unknown", registrantEmail: null });
  });
});

describe("paid is not the same as able to compete", () => {
  const paid = { paymentStatus: "paid" as const, waitlistedAt: null };
  it("needs a place AND a full pair", () => {
    expect(isEligibleToCompete({ ...paid, competitors: [1, 2] })).toBe(true);
    expect(isEligibleToCompete({ ...paid, competitors: [1] })).toBe(false);
    expect(isEligibleToCompete({ paymentStatus: "paid", waitlistedAt: new Date(), competitors: [1, 2] })).toBe(false);
    expect(isComplete({ competitors: [1] })).toBe(false);
  });
});

it("athlete membership changes are OFF unless turned on", () => {
  expect(membershipChangesEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(false);
  expect(membershipChangesEnabled({ ATHLETE_MEMBERSHIP_CHANGES: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  expect(membershipChangesEnabled({ ATHLETE_MEMBERSHIP_CHANGES: "on" } as unknown as NodeJS.ProcessEnv)).toBe(true);
});

describe("who may change the team (R2b)", () => {
  const seatsWith = (registrantPosition: 1 | 2) => [
    { id: "s1", position: 1, userId: registrantPosition === 1 ? "u-sara" : "u-mona", email: registrantPosition === 1 ? "sara@example.com" : "mona@example.com" },
    { id: "s2", position: 2, userId: registrantPosition === 2 ? "u-sara" : "u-mona", email: registrantPosition === 2 ? "sara@example.com" : "mona@example.com" },
  ];
  const owned = (competitors: ReturnType<typeof seatsWith>, ownership: "registrant" | "joint" | "unknown" = "registrant") => ({
    ownership, registrantEmail: ownership === "registrant" ? "sara@example.com" : null, registrantUserId: null, competitors,
  });

  it.each([1, 2] as const)("the registrant in seat %i may replace the other seat, not leave; the other member may only leave", (position) => {
    const team = owned(seatsWith(position));
    const other = team.competitors.find((seat) => seat.userId === "u-mona")!;
    expect(membershipRights(team, "u-sara")).toMatchObject({ role: "registrant", canReplace: other.id, canFill: false, canLeave: false });
    expect(membershipRights(team, "u-mona")).toMatchObject({ role: "member", canReplace: null, canFill: false, canLeave: true });
  });

  it("a registrant alone may fill the empty seat", () => {
    const solo = owned([{ id: "s2", position: 2, userId: "u-sara", email: "sara@example.com" }] as never);
    expect(membershipRights(solo, "u-sara")).toMatchObject({ role: "registrant", canReplace: null, canFill: true });
  });

  it("unknown and joint give nobody anything; a stranger is not on the team", () => {
    expect(membershipRights(owned(seatsWith(1), "unknown"), "u-sara")).toMatchObject({ role: "none", reason: "OWNERSHIP_UNKNOWN", canLeave: false });
    expect(membershipRights(owned(seatsWith(1), "joint"), "u-mona")).toMatchObject({ role: "none", reason: "JOINT_TEAM", canLeave: false, canReplace: null });
    expect(membershipRights(owned(seatsWith(1)), "u-nour")).toMatchObject({ role: "none", reason: "NOT_ON_TEAM" });
  });

  it("the door: finished, scored, wave started, edit window", () => {
    const open = { archivedAt: null, waveId: null, waveStatus: null, scored: false, seriesStatus: "scheduled", seriesArchived: false, competitionDate: new Date("2026-10-10T08:00:00Z") };
    const now = new Date("2026-10-01T08:00:00Z");
    expect(membershipDoor(open, now)).toEqual({ open: true });
    expect(membershipDoor({ ...open, seriesStatus: "final" }, now)).toEqual({ open: false, reason: "SERIES_FINISHED" });
    expect(membershipDoor({ ...open, scored: true }, now)).toEqual({ open: false, reason: "TEAM_ALREADY_SCORED" });
    expect(membershipDoor({ ...open, waveId: "w", waveStatus: "running" }, now)).toEqual({ open: false, reason: "WAVE_STARTED" });
    expect(membershipDoor({ ...open, waveId: "w", waveStatus: "pending" }, now)).toEqual({ open: true });
    expect(membershipDoor(open, new Date("2026-10-09T09:00:00Z"))).toEqual({ open: false, reason: "TEAM_EDIT_CLOSED" });
    // Full access passes the window — never the floor's barriers.
    expect(membershipDoor(open, new Date("2026-10-09T09:00:00Z"), true)).toEqual({ open: true });
    expect(membershipDoor({ ...open, waveId: "w", waveStatus: "running" }, new Date("2026-10-09T09:00:00Z"), true)).toEqual({ open: false, reason: "WAVE_STARTED" });
    expect(membershipDoor({ ...open, scored: true }, now, true)).toEqual({ open: false, reason: "TEAM_ALREADY_SCORED" });
    expect(membershipDoor({ ...open, seriesStatus: "final" }, now, true)).toEqual({ open: false, reason: "SERIES_FINISHED" });
  });
});

describe("who stands on the floor", () => {
  const paidSolo = { paymentStatus: "paid" as const, waitlistedAt: null, competitors: [1] };
  it("payment facts alone while the incomplete-team policy is off (today's behaviour)", () => {
    expect(onTheFloor(paidSolo, {} as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it("a full pair as well once it is on — the money is not what changes", () => {
    const hold = { INCOMPLETE_TEAM_POLICY: "hold" } as unknown as NodeJS.ProcessEnv;
    expect(onTheFloor(paidSolo, hold)).toBe(false);
    expect(onTheFloor({ ...paidSolo, competitors: [1, 2] }, hold)).toBe(true);
    expect(incompleteTeamPolicyEnabled(hold)).toBe(true);
    expect(incompleteTeamPolicyEnabled({ INCOMPLETE_TEAM_POLICY: "on" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("the 24-hour cutoff (D3a), to the millisecond", () => {
  const start = new Date("2026-10-02T15:00:00Z"); // 18:00 in Qatar
  const cutoff = teamChangesCloseAt(start);
  it("is the competition's stored start minus 24 hours", () => {
    expect(cutoff.toISOString()).toBe("2026-10-01T15:00:00.000Z");
    expect(TEAM_CHANGES_CLOSE_HOURS).toBe(24);
  });
  it.each([
    ["one millisecond before", -1, { open: true, late: false }, { open: true, late: false }],
    ["exactly at", 0, { open: false, reason: "TEAM_EDIT_CLOSED" }, { open: true, late: true }],
    ["after", 3_600_000, { open: false, reason: "TEAM_EDIT_CLOSED" }, { open: true, late: true }],
  ])("%s the cutoff: athletes, gyms and Partial access %j; Full access %j", (_label, offset, others, full) => {
    const now = new Date(cutoff.getTime() + (offset as number));
    expect(teamChangeWindow(start, now, false)).toEqual(others);
    expect(teamChangeWindow(start, now, true)).toEqual(full);
  });
  it("is shown in Qatar time", () => {
    expect(teamChangesCloseLabel(start, "en")).toMatch(/18:00/);
  });
});
