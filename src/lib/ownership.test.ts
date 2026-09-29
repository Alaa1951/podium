/**
 * Who registered a team: a person, found by account or email — never by seat
 * position — and nobody at all when it is not confirmed.
 */
import { describe, expect, it } from "vitest";

import { crmPayerEmail, incompleteTeamPolicyEnabled, isComplete, isEligibleToCompete, managingSeat, membershipChangesEnabled, membershipDoor, membershipRights, onTheFloor, ownershipFromContact, provisionalRegistrantSeat, registrantSeat, TEAM_CHANGES_CLOSE_HOURS, teamChangeWindow, teamChangesCloseAt, teamChangesCloseLabel } from "@/lib/ownership";

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

  it("unknown with both signed in and no CRM payer, and joint, give nobody anything; a stranger is not on the team", () => {
    expect(membershipRights(owned(seatsWith(1), "unknown"), "u-sara")).toMatchObject({ role: "none", reason: "OWNERSHIP_UNKNOWN", canLeave: false });
    expect(membershipRights(owned(seatsWith(1), "joint"), "u-mona")).toMatchObject({ role: "none", reason: "JOINT_TEAM", canLeave: false, canReplace: null });
    expect(membershipRights(owned(seatsWith(1)), "u-nour")).toMatchObject({ role: "none", reason: "NOT_ON_TEAM" });
  });

  it("a registrant whose email is on neither seat any more is unresolved — for BFT MENA", () => {
    expect(membershipRights({ ...owned(seatsWith(1)), registrantEmail: "gone@example.com" }, "u-sara")).toMatchObject({ role: "none", reason: "REGISTRANT_UNRESOLVED" });
  });
});

describe("not confirmed by BFT MENA: the automatic registrant", () => {
  const unknown = (competitors: { id: string; position: number; userId: string | null; email: string | null }[], payerEmail: string | null = null) => ({
    ownership: "unknown" as const, registrantEmail: null, registrantUserId: null, payerEmail, competitors,
  });
  const ola = { id: "s1", position: 1, userId: "u-ola", email: "ola@example.com" };
  const alicia = { id: "s2", position: 2, userId: null, email: "alicia@example.com" };

  it("the only member signed in manages the team: replaces the partner who has not signed in, or fills the empty seat", () => {
    expect(membershipRights(unknown([ola, alicia]), "u-ola")).toEqual({ mySeatId: "s1", role: "registrant", reason: null, canReplace: "s2", canFill: false, canLeave: false, provisional: true });
    expect(membershipRights(unknown([ola]), "u-ola")).toMatchObject({ role: "registrant", canReplace: null, canFill: true, provisional: true });
  });

  it("in seat 1 or seat 2 alike", () => {
    const signedInSeat2 = [{ ...alicia, position: 1 }, { ...ola, position: 2 }];
    expect(membershipRights(unknown(signedInSeat2), "u-ola")).toMatchObject({ role: "registrant", canReplace: "s2" });
  });

  it("the CRM payer on exactly one seat comes first — even before signing in — and the other member may only leave", () => {
    const team = unknown([ola, alicia], " Alicia@Example.com ");
    expect(provisionalRegistrantSeat(team)?.id).toBe("s2");
    expect(membershipRights(team, "u-ola")).toMatchObject({ role: "member", canReplace: null, canFill: false, canLeave: true, provisional: true });
    const both = unknown([ola, { ...alicia, userId: "u-alicia" }], "alicia@example.com");
    expect(membershipRights(both, "u-alicia")).toMatchObject({ role: "registrant", canReplace: "s1" });
  });

  it("a payer on no seat, or on both, decides nothing: the signed-in rule applies", () => {
    expect(provisionalRegistrantSeat(unknown([ola, alicia], "payer@example.com"))?.id).toBe("s1");
    expect(provisionalRegistrantSeat(unknown([ola, { ...alicia, email: "ola@example.com" }], "ola@example.com"))?.id).toBe("s1");
  });

  it("nobody when both have signed in and the CRM does not say, or when nobody has signed in", () => {
    expect(provisionalRegistrantSeat(unknown([ola, { ...alicia, userId: "u-alicia" }]))).toBeNull();
    expect(provisionalRegistrantSeat(unknown([{ ...ola, userId: null }, alicia]))).toBeNull();
  });

  it("a confirmed choice always wins over the automatic one", () => {
    const confirmed = { ...unknown([ola, alicia], "ola@example.com"), ownership: "registrant" as const, registrantEmail: "alicia@example.com" };
    expect(provisionalRegistrantSeat(confirmed)).toBeNull();
    expect(managingSeat(confirmed)?.id).toBe("s2");
    expect(membershipRights(confirmed, "u-ola")).toMatchObject({ role: "member", provisional: false });
    expect(managingSeat({ ...confirmed, ownership: "joint" as const })).toBeNull();
  });

  it("the payer's email comes only from a CRM team's own record", () => {
    expect(crmPayerEmail({ source: "ghl", rawPayload: { email: " Sara@Example.com " } })).toBe("sara@example.com");
    expect(crmPayerEmail({ source: "manual", rawPayload: { email: "sara@example.com" } })).toBeNull();
    expect(crmPayerEmail({ source: "ghl", rawPayload: null })).toBeNull();
    expect(crmPayerEmail({ source: "ghl", rawPayload: { email: 42 } })).toBeNull();
    expect(crmPayerEmail({ source: "ghl", rawPayload: ["sara@example.com"] })).toBeNull();
  });
});

describe("when the team may change", () => {
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
