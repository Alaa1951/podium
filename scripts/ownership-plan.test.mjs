import { describe, expect, it } from "vitest";

import { planOwnership } from "./ownership-plan.mjs";

const seat = (id, email, userId = null) => ({ id, email, userId });
const team = (extra) => ({
  id: "t1", source: "ghl", externalId: "c1", ownership: "unknown", registrantEmail: null,
  payerEmail: "Sara@Example.com", mergedAway: false,
  seats: [seat("s1", "sara@example.com", "u-sara"), seat("s2", "mona@example.com")],
  ...extra,
});

describe("who registered each team", () => {
  it("names the CRM payer when their email is on one seat — wherever that seat is", () => {
    expect(planOwnership([team()]).set).toEqual([
      { id: "t1", before: { ownership: "unknown", registrantEmail: null, registrantUserId: null }, after: { ownership: "registrant", registrantEmail: "sara@example.com", registrantUserId: "u-sara" } },
    ]);
    // The payer in position 2 is still the registrant: position means nothing.
    const second = team({ seats: [seat("s1", "mona@example.com"), seat("s2", "sara@example.com")] });
    expect(planOwnership([second]).set[0].after).toMatchObject({ registrantEmail: "sara@example.com", registrantUserId: null });
  });

  it.each([
    ["not from the CRM", { source: "manual" }],
    ["its CRM record was merged into another", { mergedAway: true }],
    ["the CRM record has no email", { payerEmail: null }],
    ["the payer is on no seat", { payerEmail: "someone@else.com" }],
    ["the payer's email is on both seats", { seats: [seat("s1", "sara@example.com"), seat("s2", "sara@example.com")] }],
  ])("leaves it unknown and says why: %s", (reason, extra) => {
    const plan = planOwnership([team(extra)]);
    expect(plan.set).toEqual([]);
    expect(plan.unknown).toEqual([{ id: "t1", reason }]);
  });

  it("never touches a team somebody already decided", () => {
    const plan = planOwnership([team({ ownership: "joint" }), team({ id: "t2", registrantEmail: "x@y.z" })]);
    expect(plan).toEqual({ set: [], unknown: [], alreadySet: 2 });
  });
});
