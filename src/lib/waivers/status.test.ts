/** Whether a waiver holds: the athlete's own signature of the active version — nothing else. */
import { describe, expect, it } from "vitest";

import { normaliseSignature, waiverSatisfied, waiverState } from "@/lib/waivers/status";

const base = { release: { id: "r2" }, userId: "u1", acceptances: [] };

describe("an athlete's waiver state", () => {
  it("no waiver attached to the competition: nothing required", () => {
    expect(waiverState({ ...base, release: null })).toBe("not_required");
    expect(waiverSatisfied("not_required")).toBe(true);
  });

  it("no account on the seat: the athlete must sign in first", () => {
    expect(waiverState({ ...base, userId: null })).toBe("no_account");
  });

  it("signed the active version: signed — whatever category or level the team has since", () => {
    expect(waiverState({ ...base, acceptances: [{ releaseId: "r2" }] })).toBe("signed");
  });

  it("signed only an earlier version: requires re-signing; the old record still counts as history", () => {
    expect(waiverState({ ...base, acceptances: [{ releaseId: "r1" }] })).toBe("resign");
    expect(waiverSatisfied("resign")).toBe(false);
  });

  it("never signed: pending", () => {
    expect(waiverState(base)).toBe("pending");
  });
});

describe("a typed signature", () => {
  it("accepts Arabic and English names alike, with no word-count rule", () => {
    expect(normaliseSignature("  سارة   أحمد ")).toBe("سارة أحمد");
    expect(normaliseSignature("Madonna")).toBe("Madonna");
    expect(normaliseSignature("José  O'Neil-Smith")).toBe("José O'Neil-Smith");
  });

  it("refuses a blank or letterless name", () => {
    expect(normaliseSignature("   ")).toBe("");
    expect(normaliseSignature("123 -- !")).toBe("");
  });
});
