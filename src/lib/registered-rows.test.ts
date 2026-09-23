/**
 * One mapping, three lists.
 *
 * This existed inline twice and was about to be written a third time. The
 * doc comment on `RegisteredRow.waitlistedAt` records what a copy costs: one
 * of them carried a boolean instead of the date, `teamStatus` read undefined,
 * and a paid entry sitting on the waiting list was labelled REGISTERED on the
 * very table whose job is to say otherwise.
 */
import { describe, expect, it } from "vitest";

import { toRegisteredRow } from "@/lib/registered-rows";
import { teamStatus } from "@/lib/team-status";
import type { RosterRow } from "@/lib/queries";

const WAITING_SINCE = new Date("2026-09-20T10:00:00Z");

function roster(over: Partial<RosterRow> = {}): RosterRow {
  return {
    id: "t1",
    number: 101,
    name: "IRON CLAUSE",
    category: "Mens",
    division: "Open",
    wave: 1,
    waveId: "w1",
    station: 1,
    studioId: null,
    studioName: null,
    scoreEdits: 0,
    competitors: [],
    paymentStatus: "paid",
    waitlistedAt: null,
    groupPortraitPath: null,
    source: "ghl",
    registeredAt: new Date("2026-09-01T00:00:00Z"),
    paidAt: null,
    amountMinor: 39900,
    currency: "QAR",
    billingNumber: null,
    externalId: null,
    attendedAt: null,
    values: {},
    zones: [],
    lockedZones: [],
    submitted: false,
    total: 0,
    ...over,
  } as RosterRow;
}

describe("toRegisteredRow", () => {
  // THE ONE THAT MATTERS. A Date, not a boolean and not undefined.
  it("carries the waiting date through, not a flag", () => {
    const row = toRegisteredRow(roster({ waitlistedAt: WAITING_SINCE }));
    expect(row.waitlistedAt).toBeInstanceOf(Date);
    expect(row.waitlistedAt).toEqual(WAITING_SINCE);
  });

  // The mapper and team-status.ts, pinned together — which is the pairing
  // that broke last time and was only found by somebody reading a screen.
  it("lets a PAID waiting entry still read as waiting, not registered", () => {
    const row = toRegisteredRow(roster({ paymentStatus: "paid", waitlistedAt: WAITING_SINCE }));
    expect(teamStatus(row)).toBe("waiting_list");
  });

  it("leaves an entry in the field alone", () => {
    expect(teamStatus(toRegisteredRow(roster()))).toBe("registered");
  });

  it("shows money in major units, and a dash when there is none", () => {
    expect(toRegisteredRow(roster()).amount).toBe("399.00");
    expect(toRegisteredRow(roster({ amountMinor: null })).amount).toBe("—");
  });

  // A team with no wave row shows no wave, whatever the legacy number says.
  it("reports no wave when the team is not linked to one", () => {
    expect(toRegisteredRow(roster({ waveId: null, wave: 7 })).wave).toBeNull();
    expect(toRegisteredRow(roster({ waveId: "w1", wave: 7 })).wave).toBe(7);
  });
});
