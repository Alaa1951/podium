/**
 * Who registered a team: a person, found by account or email — never by seat
 * position — and nobody at all when it is not confirmed.
 */
import { describe, expect, it } from "vitest";

import { isComplete, isEligibleToCompete, membershipChangesEnabled, ownershipFromContact, registrantSeat } from "@/lib/ownership";

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
