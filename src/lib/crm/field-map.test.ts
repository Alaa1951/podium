/**
 * The field map is the part of this integration a human has to get right, and
 * the part nothing else can check. These tests hold the two properties that
 * make a wrong map detectable instead of silent.
 */
import { describe, expect, it } from "vitest";

import { assertFieldMap, FIELD, readField, REQUIRED_FIELD_IDS } from "@/lib/crm/field-map";

const ALL_IDS = Object.values(FIELD);

describe("the map itself", () => {
  // Two fields pointing at one id means one of them is reading the other's
  // data — a copy-paste slip that produces plausible, wrong records.
  it("gives every field a distinct id", () => {
    expect(new Set(ALL_IDS).size).toBe(ALL_IDS.length);
  });

  it("names both members' copies of the fields that come in pairs", () => {
    // These four are the ones whose DISPLAY names differ only by a double
    // space, which is why they are addressed by id at all.
    expect(FIELD.bftMemberOne).not.toBe(FIELD.bftMemberTwo);
    expect(FIELD.studioOne).not.toBe(FIELD.studioTwo);
    expect(FIELD.genderOne).not.toBe(FIELD.genderTwo);
    expect(FIELD.shirtOne).not.toBe(FIELD.shirtTwo);
  });

  it("requires exactly the two fields a team cannot be built without", () => {
    expect([...REQUIRED_FIELD_IDS].sort()).toEqual([FIELD.category, FIELD.division].sort());
  });
});

describe("assertFieldMap", () => {
  it("passes when the CRM still has every field", () => {
    expect(() => assertFieldMap(ALL_IDS)).not.toThrow();
  });

  // THE POINT. A field deleted or rebuilt in the CRM form makes every read of
  // it return null, and the sync would go on writing that value blank, one
  // poll at a time, with nothing in any log to say so.
  it("fails loudly, and names what went missing", () => {
    const withoutCategory = ALL_IDS.filter((id) => id !== FIELD.category);
    expect(() => assertFieldMap(withoutCategory)).toThrow(/category/);
  });

  it("names every missing field, not just the first", () => {
    expect(() => assertFieldMap([])).toThrow(/teamName[\s\S]*division/);
  });
});

describe("readField", () => {
  const contact = {
    id: "c1",
    customFields: [
      { id: "single", value: "M" },
      { id: "choice", value: ["OPEN"] },
      { id: "blank", value: "   " },
      { id: "empty-choice", value: [] },
      { id: "nulled", value: null },
      { id: "numeric", value: 801619200000 },
    ],
  };

  it("unwraps the array GHL puts around a single choice", () => {
    expect(readField(contact, "choice")).toBe("OPEN");
    expect(readField(contact, "single")).toBe("M");
  });

  // Whitespace, an empty choice and an absent field are all "no answer", and
  // the difference between them is not one any caller should have to know.
  it("treats every shape of emptiness as null", () => {
    expect(readField(contact, "blank")).toBeNull();
    expect(readField(contact, "empty-choice")).toBeNull();
    expect(readField(contact, "nulled")).toBeNull();
    expect(readField(contact, "not-there")).toBeNull();
    expect(readField({ id: "c2" }, "anything")).toBeNull();
  });

  it("stringifies a number, because a GHL date arrives as epoch millis", () => {
    expect(readField(contact, "numeric")).toBe("801619200000");
  });
});
