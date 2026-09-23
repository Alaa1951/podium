/**
 * The rules of the CRM sync, tested without a CRM.
 *
 * The live system moves while you read it — its counts changed twice during a
 * single afternoon of exploring it — so everything that DECIDES anything is a
 * pure function over a snapshot, and this is where those decisions are pinned.
 *
 * The fixtures are synthetic on purpose. The real records are eighty-five
 * people's names, emails, phone numbers and dates of birth, and a test fixture
 * is a file that gets copied into logs, CI output and bug reports.
 */
import { describe, expect, it } from "vitest";

import { FIELD } from "@/lib/crm/field-map";
import {
  draftFrom,
  paymentFromStage,
  reconcile,
  summarise,
  type ExistingTeam,
  type Snapshot,
} from "@/lib/crm/reconcile";

const STAGE = {
  paidRegistered: "stage-paid-registered",
  paidNotRegistered: "stage-paid-not-registered",
  registeredNotPaid: "stage-registered-not-paid",
};

const PIPELINES = [
  {
    id: "pipe-1",
    name: "Podium Series 1",
    stages: [
      { id: STAGE.paidRegistered, name: "Paid – Registered" },
      { id: STAGE.paidNotRegistered, name: "Paid – Not Registered" },
      { id: STAGE.registeredNotPaid, name: "Registered but Not Paid" },
    ],
  },
];

const STUDIOS = ["Corniche", "Gharrafa", "The Pearl", "West Walk"];

/**
 * A contact with the fields a complete registration carries.
 *
 * `extra.customFields` OVERRIDES the base entries with the same field id and
 * adds the rest — a real contact carries at most one value per field, so a
 * fixture that appended a second one would be testing a shape GHL never
 * returns (and `readField` takes the first, so the override would do nothing).
 */
function contact(id: string, extra: Record<string, unknown> = {}) {
  const { customFields: added, ...rest } = extra;
  const overrides = (added as { id: string; value: unknown }[]) ?? [];
  const overridden = new Set(overrides.map((field) => field.id));
  const base = [
    { id: FIELD.category, value: ["MEN"] },
    { id: FIELD.division, value: ["OPEN"] },
    { id: FIELD.teamName, value: "Iron Clause" },
    { id: FIELD.nameTwo, value: "Second Person" },
    { id: FIELD.emailTwo, value: "Two@Example.com" },
    { id: FIELD.studioOne, value: ["BFT The Pearl"] },
  ].filter((field) => !overridden.has(field.id));

  return {
    ...rest,
    id,
    contactName: "Sample Person",
    email: "One@Example.com",
    phone: "+97400000000",
    customFields: [...base, ...overrides],
  };
}

function opportunity(contactId: string, stageId: string) {
  return { id: `opp-${contactId}`, contactId, pipelineId: "pipe-1", pipelineStageId: stageId, status: "open" };
}

function snapshot(partial: Partial<Snapshot>): Snapshot {
  return {
    contacts: [],
    opportunities: [],
    pipelines: PIPELINES,
    studioNames: STUDIOS,
    teams: [],
    registrationClosesAt: null,
    ...partial,
  };
}

describe("paymentFromStage", () => {
  // THE ORDER OF THE TESTS INSIDE THE FUNCTION IS THE WHOLE TRICK. Two of the
  // three real stage names contain the word "Paid" while meaning the opposite.
  it("reads the three real stage names correctly", () => {
    expect(paymentFromStage("Podium Series 1", "Paid – Registered")).toBe("paid");
    expect(paymentFromStage("Podium Series 1", "Paid – Not Registered")).toBe("paid");
    expect(paymentFromStage("Podium Series 1", "Registered but Not Paid")).toBe("pending");
  });

  it("treats a refund pipeline as refunded, whatever its stages are called", () => {
    expect(paymentFromStage("Podium Refunds", "Processed")).toBe("refunded");
    expect(paymentFromStage("Podium Series 1", "Refund requested")).toBe("refunded");
  });

  // A stage somebody adds in the CRM UI next month must not quietly become
  // "paid" — which is money this system would then believe it had received.
  it("refuses to guess at a stage it does not recognise", () => {
    expect(paymentFromStage("Podium Series 1", "Waiting list")).toBeNull();
    expect(paymentFromStage("Podium Series 1", "")).toBeNull();
  });
});

describe("draftFrom", () => {
  it("builds both seats, member 1 from the contact and member 2 from the fields", () => {
    const result = draftFrom(contact("c1"), "paid", STUDIOS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.draft.seats).toHaveLength(2);
    expect(result.draft.seats[0]).toMatchObject({ position: 1, fullName: "Sample Person" });
    expect(result.draft.seats[1]).toMatchObject({ position: 2, fullName: "Second Person" });
    // Emails are lowercased on the way in, as every other registration path does.
    expect(result.draft.seats[0].email).toBe("one@example.com");
    expect(result.draft.seats[1].email).toBe("two@example.com");
  });

  it("uppercases the team name, and falls back to the first competitor", () => {
    const withName = draftFrom(contact("c1"), "paid", STUDIOS);
    expect(withName.ok && withName.draft.name).toBe("IRON CLAUSE");

    const blank = contact("c2");
    blank.customFields = blank.customFields.filter((field) => field.id !== FIELD.teamName);
    const without = draftFrom(blank, "paid", STUDIOS);
    expect(without.ok && without.draft.name).toBe("SAMPLE PERSON");
  });

  // THE ONE THAT MATTERS. Division decides the prescribed loads a pair lifts
  // (LoadStandard is keyed on [division, sex]). A filled-in guess here is a
  // team handed the wrong weights, found out on the floor on the morning.
  it("refuses a record with no category or no division, and says which", () => {
    const noCategory = contact("c3");
    noCategory.customFields = noCategory.customFields.filter((field) => field.id !== FIELD.category);
    expect(draftFrom(noCategory, "paid", STUDIOS)).toEqual({ ok: false, reason: "no category" });

    const noDivision = contact("c4");
    noDivision.customFields = noDivision.customFields.filter((field) => field.id !== FIELD.division);
    expect(draftFrom(noDivision, "paid", STUDIOS)).toEqual({ ok: false, reason: "no division" });

    // The shape thirty-one of the eighty-five real records are in.
    const neither = contact("c5");
    neither.customFields = neither.customFields.filter(
      (field) => field.id !== FIELD.category && field.id !== FIELD.division
    );
    expect(draftFrom(neither, "paid", STUDIOS)).toEqual({
      ok: false,
      reason: "no category and no division",
    });
  });

  it("strips the CRM's prefix and gendered suffix off a studio name", () => {
    const westWalk = contact("c6", {
      customFields: [{ id: FIELD.studioTwo, value: ["BFT West Walk  Female"] }],
    });
    const result = draftFrom(westWalk, "paid", STUDIOS);
    expect(result.ok && result.draft.seats[0].studioName).toBe("The Pearl");
    expect(result.ok && result.draft.seats[1].studioName).toBe("West Walk");
  });

  // A studio PODIUM has not heard of is still that person's studio. Returning
  // null here is how a real membership used to be thrown away — the caller
  // founds the studio instead, the way approveSignup already does.
  it("keeps a studio it does not recognise, cleaned rather than dropped", () => {
    const unknown = contact("c7", {
      customFields: [{ id: FIELD.studioOne, value: ["BFT Somewhere Else"] }],
    });
    const result = draftFrom(unknown, "paid", STUDIOS);
    expect(result.ok && result.draft.seats[0].studioName).toBe("Somewhere Else");
  });

  // `known` fixes the SPELLING and nothing else: a studio written in a
  // different case must land on the existing row, not found a second one
  // beside it with the same name in different letters.
  it("corrects the spelling of a studio it does recognise", () => {
    const shouted = contact("c8", {
      customFields: [{ id: FIELD.studioOne, value: ["BFT  the  pearl "] }],
    });
    const result = draftFrom(shouted, "paid", STUDIOS);
    expect(result.ok && result.draft.seats[0].studioName).toBe("The Pearl");
  });

  // Null still means exactly one thing: the CRM field was empty. A competitor
  // who belongs to no studio is allowed, common, and a figure the reports are
  // asked for — so an empty field must never become an invented studio.
  it("leaves the studio null when the CRM said nothing", () => {
    const none = contact("c9");
    none.customFields = none.customFields.filter((field) => field.id !== FIELD.studioOne);
    const result = draftFrom(none, "paid", STUDIOS);
    expect(result.ok && result.draft.seats[0].studioName).toBeNull();
  });
});

describe("reconcile", () => {
  it("creates a team for a complete contact and HOLDS an incomplete one", () => {
    const complete = contact("complete");
    const incomplete = contact("incomplete");
    incomplete.customFields = incomplete.customFields.filter(
      (field) => field.id !== FIELD.category && field.id !== FIELD.division
    );

    const actions = reconcile(
      snapshot({
        contacts: [complete, incomplete],
        opportunities: [
          opportunity("complete", STAGE.paidRegistered),
          opportunity("incomplete", STAGE.paidNotRegistered),
        ],
      })
    );

    expect(summarise(actions)).toMatchObject({ create: 1, update: 0, intake: 1, skip: 0 });
    expect(actions[0]).toMatchObject({ kind: "create", externalId: "complete" });
    // NOT discarded. An unfinished registration is still somebody who paid and
    // expects to compete, and it is carried with enough to chase them.
    expect(actions[1]).toMatchObject({
      kind: "intake",
      externalId: "incomplete",
      intake: {
        contactName: "Sample Person",
        email: "one@example.com",
        partnerName: "Second Person",
        teamName: "Iron Clause",
        stageName: "Paid – Not Registered",
        missing: "no category and no division",
      },
    });
  });

  // The shape of the real data on the day this was written: eighty-five
  // contacts, fifty-four of them complete.
  it("reproduces the live proportions on a snapshot shaped like the real one", () => {
    const contacts = [];
    const opportunities = [];
    for (let index = 0; index < 54; index += 1) {
      contacts.push(contact(`ok-${index}`));
      opportunities.push(opportunity(`ok-${index}`, STAGE.paidRegistered));
    }
    for (let index = 0; index < 31; index += 1) {
      const thin = contact(`thin-${index}`);
      thin.customFields = thin.customFields.filter(
        (field) => field.id !== FIELD.category && field.id !== FIELD.division
      );
      contacts.push(thin);
      opportunities.push(opportunity(`thin-${index}`, STAGE.paidNotRegistered));
    }

    const actions = reconcile(snapshot({ contacts, opportunities }));
    expect(summarise(actions)).toMatchObject({
      create: 54,
      intake: 31,
      skip: 0,
      reasons: { "no category and no division": 31 },
    });
    // EVERY contact is accounted for. Eighty-five in, eighty-five out — the
    // count is the property, because a record that falls out of this loop
    // falls out of the system with nothing anywhere to say it existed.
    expect(actions).toHaveLength(85);
    expect(new Set(actions.map((action) => action.externalId)).size).toBe(85);
  });

  // THE SAFETY RULE. A team entered through self sign-up or by a studio has no
  // externalId, and the CRM must never write over somebody else's work.
  it("never touches a team this integration did not create", () => {
    const mine: ExistingTeam = {
      id: "t-mine",
      externalId: "c1",
      source: "ghl",
      paymentStatus: "pending",
      amountMinor: null,
      billingNumber: null,
    };
    const theirs: ExistingTeam = {
      id: "t-theirs",
      externalId: "c1",
      source: "signup",
      paymentStatus: "pending",
      amountMinor: null,
      billingNumber: null,
    };

    const onlyTheirs = reconcile(
      snapshot({
        contacts: [contact("c1")],
        opportunities: [opportunity("c1", STAGE.paidRegistered)],
        teams: [theirs],
      })
    );
    // Not an update of their team — a create, because ours does not exist.
    expect(onlyTheirs[0].kind).toBe("create");

    const withMine = reconcile(
      snapshot({
        contacts: [contact("c1")],
        opportunities: [opportunity("c1", STAGE.paidRegistered)],
        teams: [mine, theirs],
      })
    );
    expect(withMine[0]).toMatchObject({ kind: "update", teamId: "t-mine" });
  });

  // Money is the CRM's to own. Everything else is left alone once a team
  // exists: category and division decide the bracket and the loads, and a
  // silent rewrite on the morning is how a pair ends up in the wrong one.
  it("updates only money on a team that already exists", () => {
    const existing: ExistingTeam = {
      id: "t1",
      externalId: "c1",
      source: "ghl",
      paymentStatus: "pending",
      amountMinor: null,
      billingNumber: null,
    };
    const paying = contact("c1", {
      customFields: [
        { id: FIELD.paidAmount, value: "250" },
        { id: FIELD.invoice, value: "INV-9" },
      ],
    });

    const actions = reconcile(
      snapshot({
        contacts: [paying],
        opportunities: [opportunity("c1", STAGE.paidRegistered)],
        teams: [existing],
      })
    );

    expect(actions[0]).toEqual({
      kind: "update",
      externalId: "c1",
      teamId: "t1",
      changes: { paymentStatus: "paid", amountMinor: 25000, billingNumber: "INV-9" },
    });
    // And nothing else came along for the ride.
    expect(Object.keys((actions[0] as { changes: object }).changes)).toEqual([
      "paymentStatus",
      "amountMinor",
      "billingNumber",
    ]);
  });

  it("does nothing at all when the two sides already agree", () => {
    const existing: ExistingTeam = {
      id: "t1",
      externalId: "c1",
      source: "ghl",
      paymentStatus: "paid",
      amountMinor: null,
      billingNumber: null,
    };
    const actions = reconcile(
      snapshot({
        contacts: [contact("c1")],
        opportunities: [opportunity("c1", STAGE.paidRegistered)],
        teams: [existing],
      })
    );
    expect(actions[0]).toMatchObject({ kind: "skip", reason: "already in step" });
  });

  it("holds a contact with no opportunity rather than guessing its state", () => {
    const actions = reconcile(snapshot({ contacts: [contact("c1")], opportunities: [] }));
    expect(actions[0]).toMatchObject({
      kind: "intake",
      intake: { missing: "not in the pipeline", stageName: null },
    });
  });

  it("holds a stage it cannot classify instead of assuming payment", () => {
    const actions = reconcile(
      snapshot({
        contacts: [contact("c1")],
        opportunities: [opportunity("c1", "stage-unknown")],
        pipelines: [
          { id: "pipe-1", name: "Podium Series 1", stages: [{ id: "stage-unknown", name: "Waiting list" }] },
        ],
      })
    );
    expect(actions[0]).toMatchObject({ kind: "intake" });
    expect((actions[0] as { intake: { missing: string } }).intake.missing).toContain("Waiting list");
  });
});
