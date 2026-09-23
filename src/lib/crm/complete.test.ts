/**
 * Finishing a held registration, and the two rules that keep it safe.
 *
 * This is the first code in the project that writes to the CRM, and the write
 * body's shape is the one thing no test can verify — GHL resolves the record
 * before it validates the body, so a wrong shape and a right one come back
 * identical. What CAN be pinned down is everything around the shape, and that
 * is what is here:
 *
 *   THE MONEY AXIS IS NEVER TRAVELLED. The stage says paid × form-finished in
 *   one value. PODIUM may say the form is finished. It may not say anything
 *   about money, because the stage is where it READS money from.
 *
 *   NOTHING IS EVER ERASED. An answer not supplied produces no field, not a
 *   blank one — so completing half a form cannot wipe what somebody typed in
 *   themselves weeks ago.
 *
 *   EVERY PICKLIST VALUE IS ONE THE CRM OFFERS. The values were read off the
 *   live field definitions on 23 September 2026, and the round-trip test below
 *   is what will notice if the two ever disagree again.
 */
import { describe, expect, it } from "vitest";

import {
  completionFields,
  registeredFromStage,
  stageAfterCompleting,
  studioOption,
  type CompletionAnswers,
  type FieldOptions,
} from "@/lib/crm/complete";
import { FIELD, UNWRITABLE_FIELD_IDS } from "@/lib/crm/field-map";
import { toCategory, toDivision } from "@/lib/crm/values";
import type { CrmPipeline } from "@/lib/crm/client";

/** The live option lists, copied from the CRM's own field definitions. */
const OPTIONS: FieldOptions = {
  [FIELD.category]: ["MEN", "WOMEN", "MIXED"],
  [FIELD.division]: ["ROOKIE", "OPEN", "PRO"],
  [FIELD.havePartner]: ["Yes", "No - Looking for a partner"],
  [FIELD.genderTwo]: ["Male", "Female"],
  [FIELD.shirtTwo]: ["XS", "S", "M", "L", "XL", "XXL"],
  [FIELD.bftMemberTwo]: ["I am a BFT member"],
  [FIELD.studioTwo]: [
    "BFT West Walk  Male",
    "BFT West Walk  Female",
    "BFT Al Gharrafa Male",
    "BFT Al Gharrafa Female",
    "BFT The Pearl",
    "BFT Courniche",
  ],
};

const NOTHING: CompletionAnswers = {
  category: null,
  division: null,
  teamName: null,
  partner: null,
};

/** The value written for one field, or undefined if it was not written. */
function valueOf(fields: { id: string; value: string | string[] }[], id: string) {
  return fields.find((field) => field.id === id)?.value;
}

describe("completionFields — the two blocking answers", () => {
  it("writes the CRM's own words for category and division, wrapped as the picklist wants", () => {
    const { fields, dropped } = completionFields(
      { ...NOTHING, category: "Mens", division: "Rookie" },
      OPTIONS
    );
    expect(valueOf(fields, FIELD.category)).toEqual(["MEN"]);
    expect(valueOf(fields, FIELD.division)).toEqual(["ROOKIE"]);
    expect(dropped).toEqual([]);
  });

  // THE CARRYING TEST. The read path turns "MEN" into "Mens"; the write path
  // has to turn "Mens" back into something the read path accepts, or a record
  // PODIUM completes becomes a record PODIUM can no longer import. Writing the
  // two halves in separate files is exactly how that drifts.
  it("writes values its own reader can read back — for every category and division", () => {
    for (const category of ["Mens", "Womens", "Mixed"] as const) {
      const { fields } = completionFields({ ...NOTHING, category }, OPTIONS);
      const written = valueOf(fields, FIELD.category) as string[];
      expect(toCategory(written[0])).toBe(category);
    }
    for (const division of ["Rookie", "Open", "Pro"] as const) {
      const { fields } = completionFields({ ...NOTHING, division }, OPTIONS);
      const written = valueOf(fields, FIELD.division) as string[];
      expect(toDivision(written[0])).toBe(division);
    }
  });

  it("drops rather than invents when the CRM stops offering an option", () => {
    const narrowed: FieldOptions = { ...OPTIONS, [FIELD.division]: ["OPEN", "PRO"] };
    const { fields, dropped } = completionFields({ ...NOTHING, division: "Rookie" }, narrowed);
    expect(valueOf(fields, FIELD.division)).toBeUndefined();
    expect(dropped).toEqual(["division"]);
  });

  it("writes nothing at all when it is told nothing — it cannot erase", () => {
    expect(completionFields(NOTHING, OPTIONS)).toEqual({ fields: [], dropped: [] });
  });

  // The guard that makes "the CRM owns the money" structural rather than
  // intended. If a completion ever carried an amount, this is where it stops.
  it("never names a money field, whatever it is asked to complete", () => {
    const { fields } = completionFields(
      {
        category: "Mixed",
        division: "Pro",
        teamName: "PRIME",
        partner: {
          fullName: "Dalal Alhamad",
          email: "d@example.com",
          phone: "66660274",
          gender: "Female",
          shirtSize: "M",
          bftMember: true,
          studioName: "The Pearl",
        },
      },
      OPTIONS
    );
    for (const id of UNWRITABLE_FIELD_IDS) {
      expect(fields.some((field) => field.id === id)).toBe(false);
    }
  });
});

describe("completionFields — the partner", () => {
  const partner = {
    fullName: "  Dalal Alhamad  ",
    email: "DALAL@Example.COM",
    phone: "66660274",
    gender: "Female" as const,
    shirtSize: "M" as const,
    bftMember: true,
    studioName: "The Pearl",
  };

  it("writes the partner, tidied, and says Yes in the CRM's own wording", () => {
    const { fields, dropped } = completionFields({ ...NOTHING, partner }, OPTIONS);
    expect(valueOf(fields, FIELD.nameTwo)).toBe("Dalal Alhamad");
    expect(valueOf(fields, FIELD.emailTwo)).toBe("dalal@example.com");
    expect(valueOf(fields, FIELD.phoneTwo)).toBe("66660274");
    expect(valueOf(fields, FIELD.genderTwo)).toBe("Female");
    expect(valueOf(fields, FIELD.shirtTwo)).toBe("M");
    expect(valueOf(fields, FIELD.bftMemberTwo)).toEqual(["I am a BFT member"]);
    expect(valueOf(fields, FIELD.havePartner)).toBe("Yes");
    expect(dropped).toEqual([]);
  });

  // A blank in PODIUM is not an answer, so it is not sent. Anything else would
  // let a staff member who only knew the name wipe the phone number the
  // registrant had typed in themselves.
  it("leaves out every blank instead of sending it", () => {
    const { fields } = completionFields(
      {
        ...NOTHING,
        partner: { ...partner, email: null, phone: "   ", gender: null, shirtSize: null, studioName: null },
      },
      OPTIONS
    );
    for (const id of [FIELD.emailTwo, FIELD.phoneTwo, FIELD.genderTwo, FIELD.shirtTwo, FIELD.studioTwo]) {
      expect(valueOf(fields, id)).toBeUndefined();
    }
    expect(valueOf(fields, FIELD.nameTwo)).toBe("Dalal Alhamad");
  });

  it("does not write an unticked membership box — a blank is not a no", () => {
    const { fields, dropped } = completionFields(
      { ...NOTHING, partner: { ...partner, bftMember: false } },
      OPTIONS
    );
    expect(valueOf(fields, FIELD.bftMemberTwo)).toBeUndefined();
    expect(dropped).toEqual([]);
  });
});

describe("studioOption — one studio, sometimes two doors", () => {
  const options = OPTIONS[FIELD.studioTwo]!;

  it("finds the one option for a studio that has one", () => {
    expect(studioOption("The Pearl", null, options)).toBe("BFT The Pearl");
    expect(studioOption("the pearl", "Male", options)).toBe("BFT The Pearl");
  });

  // The double space in "West Walk  Female" is the CRM's, and it is why this
  // returns the CRM's label rather than rebuilding one.
  it("picks the door that matches the person, double space and all", () => {
    expect(studioOption("West Walk", "Female", options)).toBe("BFT West Walk  Female");
    expect(studioOption("Al Gharrafa", "Male", options)).toBe("BFT Al Gharrafa Male");
  });

  it("refuses to guess a door when it does not know the person's gender", () => {
    expect(studioOption("West Walk", null, options)).toBeNull();
  });

  it("writes no studio at all rather than a wrong one", () => {
    expect(studioOption("Lusail", "Male", options)).toBeNull();
    const { fields, dropped } = completionFields(
      {
        ...NOTHING,
        partner: {
          fullName: "Aly Farhat",
          email: null,
          phone: null,
          gender: null,
          shirtSize: null,
          bftMember: false,
          studioName: "West Walk",
        },
      },
      OPTIONS
    );
    expect(valueOf(fields, FIELD.studioTwo)).toBeUndefined();
    expect(dropped).toEqual(["partner studio"]);
  });
});

describe("registeredFromStage", () => {
  // "Paid – Not Registered" contains the word "Registered". Ruling the longer
  // phrase out first is the whole of this function.
  it("reads the live stage names the right way round", () => {
    expect(registeredFromStage("Paid – Not Registered")).toBe(false);
    expect(registeredFromStage("Paid – Registered")).toBe(true);
    expect(registeredFromStage("Registered but Not Paid")).toBe(true);
  });

  it("answers null for a stage it was never told about", () => {
    expect(registeredFromStage("Waiting on sponsor")).toBeNull();
  });
});

describe("stageAfterCompleting — the money axis is never travelled", () => {
  const LIVE: CrmPipeline[] = [
    {
      id: "pipe-1",
      name: "Podium Series 1",
      stages: [
        { id: "s-paid-reg", name: "Paid – Registered" },
        { id: "s-paid-not", name: "Paid – Not Registered" },
        { id: "s-reg-not-paid", name: "Registered but Not Paid" },
      ],
    },
  ];

  // The one transition that matters: nearly every held record on the live CRM
  // sits in "Paid – Not Registered".
  it("moves a paid record from not-registered to registered", () => {
    expect(stageAfterCompleting(LIVE, "s-paid-not")).toEqual({
      pipelineId: "pipe-1",
      stageId: "s-paid-reg",
    });
  });

  it("does nothing when the stage already says registered", () => {
    expect(stageAfterCompleting(LIVE, "s-paid-reg")).toBeNull();
    expect(stageAfterCompleting(LIVE, "s-reg-not-paid")).toBeNull();
  });

  // 🔴 THE TEST THIS FILE EXISTS FOR. An unpaid record whose only registered
  // stage is a PAID one must not move: landing it there would be PODIUM
  // declaring money it was never told about, and the next poll would read that
  // back as a confirmed payment and put the pair on the board for free.
  it("refuses to move when the only registered stage would also claim payment", () => {
    const noUnpaidRegistered: CrmPipeline[] = [
      {
        id: "pipe-1",
        name: "Podium Series 1",
        stages: [
          { id: "s-paid-reg", name: "Paid – Registered" },
          { id: "s-unpaid-unreg", name: "Not Paid – Not Registered" },
        ],
      },
    ];
    expect(stageAfterCompleting(noUnpaidRegistered, "s-unpaid-unreg")).toBeNull();
  });

  // The mirror of the test above, and the reason it is a search and not a
  // hardcoded destination: an unpaid record may still be marked as having
  // finished its form, because "Registered but Not Paid" says nothing new
  // about money.
  it("does move an unpaid record along the unpaid row, where such a stage exists", () => {
    const unpaidUnregistered: CrmPipeline[] = [
      {
        id: "pipe-1",
        name: "Podium Series 1",
        stages: [
          { id: "s-paid-reg", name: "Paid – Registered" },
          { id: "s-reg-not-paid", name: "Registered but Not Paid" },
          { id: "s-unpaid-unreg", name: "Not Paid – Not Registered" },
        ],
      },
    ];
    expect(stageAfterCompleting(unpaidUnregistered, "s-unpaid-unreg")).toEqual({
      pipelineId: "pipe-1",
      stageId: "s-reg-not-paid",
    });
  });

  it("keeps out of the refund pipeline entirely", () => {
    const refunds: CrmPipeline[] = [
      {
        id: "pipe-2",
        name: "Podium Refunds",
        stages: [
          { id: "r-1", name: "Refund requested" },
          { id: "r-2", name: "Refunded – Registered" },
        ],
      },
    ];
    expect(stageAfterCompleting(refunds, "r-1")).toBeNull();
  });

  it("does nothing for a stage it cannot classify, and nothing for one it cannot find", () => {
    const odd: CrmPipeline[] = [
      { id: "p", name: "Podium Series 1", stages: [{ id: "x", name: "Waiting on sponsor" }] },
    ];
    expect(stageAfterCompleting(odd, "x")).toBeNull();
    expect(stageAfterCompleting(LIVE, "no-such-stage")).toBeNull();
  });

  it("never proposes a stage on a different pipeline than the one it found", () => {
    const two: CrmPipeline[] = [
      ...LIVE,
      { id: "pipe-9", name: "Other", stages: [{ id: "o-1", name: "Paid – Registered" }] },
    ];
    expect(stageAfterCompleting(two, "s-paid-not")?.pipelineId).toBe("pipe-1");
  });
});
