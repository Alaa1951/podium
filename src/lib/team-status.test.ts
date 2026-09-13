/**
 * The derived STATUS column, tested across every combination.
 *
 * There are only eight of them, so this file simply walks all eight rather than
 * picking interesting cases — the point of deriving the status was that no
 * combination can be left undefined.
 */
import { describe, expect, it } from "vitest";

import type { PaymentStatus } from "@/generated/prisma/enums";
import { isCompeting, teamStatus, teamStatusTone } from "@/lib/team-status";

const PAYMENTS: PaymentStatus[] = ["pending", "paid", "refunded"];

describe("teamStatus — one word per team", () => {
  it("reads an unpaid team as awaiting payment, scored or not", () => {
    expect(teamStatus({ paymentStatus: "pending", submitted: false })).toBe("awaiting_payment");
    expect(teamStatus({ paymentStatus: "pending", submitted: true })).toBe("awaiting_payment");
  });

  it("reads a paid team with no score as registered", () => {
    expect(teamStatus({ paymentStatus: "paid", submitted: false })).toBe("registered");
  });

  it("reads a paid team with a submitted score as submitted", () => {
    expect(teamStatus({ paymentStatus: "paid", submitted: true })).toBe("submitted");
  });

  it("lets a refund override a submitted score", () => {
    // A refunded team is out, whatever is recorded against it. Showing it as
    // SUBMITTED would put it on screen as a live entry.
    expect(teamStatus({ paymentStatus: "refunded", submitted: true })).toBe("refunded");
    expect(teamStatus({ paymentStatus: "refunded", submitted: false })).toBe("refunded");
  });

  it("returns a known status and a known tone for every combination", () => {
    for (const paymentStatus of PAYMENTS) {
      for (const submitted of [true, false]) {
        const status = teamStatus({ paymentStatus, submitted });
        expect(["refunded", "awaiting_payment", "registered", "submitted"]).toContain(status);
        expect(teamStatusTone(status)).toMatch(/^badge-/);
      }
    }
  });
});

describe("isCompeting — is this a real entry yet", () => {
  it("counts only a paid team", () => {
    expect(isCompeting({ paymentStatus: "paid", submitted: false })).toBe(true);
    expect(isCompeting({ paymentStatus: "pending", submitted: true })).toBe(false);
    expect(isCompeting({ paymentStatus: "refunded", submitted: true })).toBe(false);
  });
});
