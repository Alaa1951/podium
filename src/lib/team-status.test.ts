/**
 * The derived STATUS column, tested across every combination.
 *
 * The file walks ALL combinations rather than picking interesting ones — the
 * point of deriving the status was that no combination can be left undefined.
 * A third fact (the waiting list) makes twelve of them, and the reason to keep
 * walking them is unchanged.
 */
import { describe, expect, it } from "vitest";

import type { PaymentStatus } from "@/generated/prisma/enums";
import { isCompeting, teamStatus, teamStatusTone } from "@/lib/team-status";

const PAYMENTS: PaymentStatus[] = ["pending", "paid", "refunded"];
const WAITING = new Date("2026-09-21T10:00:00Z");

describe("teamStatus — one word per team", () => {
  it("reads an unpaid team as awaiting payment, scored or not", () => {
    expect(teamStatus({ paymentStatus: "pending", submitted: false, waitlistedAt: null })).toBe("awaiting_payment");
    expect(teamStatus({ paymentStatus: "pending", submitted: true, waitlistedAt: null })).toBe("awaiting_payment");
  });

  it("reads a paid team with no score as registered", () => {
    expect(teamStatus({ paymentStatus: "paid", submitted: false, waitlistedAt: null })).toBe("registered");
  });

  it("reads a paid team with a submitted score as submitted", () => {
    expect(teamStatus({ paymentStatus: "paid", submitted: true, waitlistedAt: null })).toBe("submitted");
  });

  it("lets a refund override a submitted score", () => {
    // A refunded team is out, whatever is recorded against it. Showing it as
    // SUBMITTED would put it on screen as a live entry.
    expect(teamStatus({ paymentStatus: "refunded", submitted: true, waitlistedAt: null })).toBe("refunded");
    expect(teamStatus({ paymentStatus: "refunded", submitted: false, waitlistedAt: null })).toBe("refunded");
  });

  // ── The waiting list ───────────────────────────────────────────────────────

  it("says WAITING LIST to somebody who has paid — money does not buy a place", () => {
    // The rule BFT MENA asked for, and the one place it can be got wrong. If
    // payment were read first this would say REGISTERED, and somebody would
    // turn up to a competition with no station for them.
    expect(teamStatus({ paymentStatus: "paid", submitted: false, waitlistedAt: WAITING })).toBe(
      "waiting_list"
    );
  });

  it("says WAITING LIST before payment too", () => {
    expect(teamStatus({ paymentStatus: "pending", submitted: false, waitlistedAt: WAITING })).toBe(
      "waiting_list"
    );
  });

  it("still lets a refund win — that is the end of the story", () => {
    expect(teamStatus({ paymentStatus: "refunded", submitted: false, waitlistedAt: WAITING })).toBe(
      "refunded"
    );
  });

  it("treats null as a place in the field, not as waiting", () => {
    expect(teamStatus({ paymentStatus: "paid", submitted: false, waitlistedAt: null })).toBe(
      "registered"
    );
  });

  it("returns a known status and a known tone for every combination", () => {
    for (const paymentStatus of PAYMENTS) {
      for (const submitted of [true, false]) {
        for (const waitlistedAt of [WAITING, null]) {
          const status = teamStatus({ paymentStatus, submitted, waitlistedAt });
          expect([
            "refunded",
            "waiting_list",
            "awaiting_payment",
            "registered",
            "submitted",
          ]).toContain(status);
          expect(teamStatusTone(status)).toMatch(/^badge-/);
        }
      }
    }
  });
});

describe("isCompeting — the one gate", () => {
  it("counts only a paid team", () => {
    expect(isCompeting({ paymentStatus: "paid", waitlistedAt: null })).toBe(true);
    expect(isCompeting({ paymentStatus: "pending", waitlistedAt: null })).toBe(false);
    expect(isCompeting({ paymentStatus: "refunded", waitlistedAt: null })).toBe(false);
  });

  it("REFUSES a paid team on the waiting list", () => {
    // This single expectation is what keeps a waitlisted entry off the live
    // board, out of the takings, and unable to sign anybody in — every one of
    // those gates now asks this function and nothing else.
    expect(isCompeting({ paymentStatus: "paid", waitlistedAt: WAITING })).toBe(false);
  });

  it("demands the fact rather than defaulting it", () => {
    // Not a runtime assertion — a COMPILE-TIME one. `waitlistedAt` was optional
    // for exactly one release, and in that release the registrations table
    // stopped passing it and labelled a paid waiting entry REGISTERED. The
    // suppression below fails the build the day anybody makes it optional
    // again, because there would then be no error left for it to suppress.
    const forgotTheFact = { paymentStatus: "paid" } as const;
    // @ts-expect-error waitlistedAt is required on purpose
    const wrong = isCompeting(forgotTheFact);
    // Read it so the variable is not merely unused; the assertion above is the
    // real subject of the test.
    expect(typeof wrong).toBe("boolean");
  });
});
