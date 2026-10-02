/**
 * The search every list uses: words in any order, Arabic spelling variants
 * and accents forgiven, phones by digits, team numbers exactly.
 */
import { describe, expect, it } from "vitest";

import { foldText, matchesSearch, searchTokens } from "@/lib/search";

describe("folding text", () => {
  it("ignores case and accents", () => {
    expect(foldText("José ÁLVAREZ")).toBe("jose alvarez");
  });

  it("treats Arabic spelling variants as one", () => {
    expect(foldText("أحمد")).toBe(foldText("احمد"));
    expect(foldText("إسلام")).toBe(foldText("اسلام"));
    expect(foldText("آمنة")).toBe(foldText("امنه"));
    expect(foldText("مصطفى")).toBe(foldText("مصطفي"));
    expect(foldText("مُحَمَّد")).toBe(foldText("محمد"));
    expect(foldText("محـــمد")).toBe(foldText("محمد"));
  });

  it("reads Arabic-Indic digits as digits", () => {
    expect(foldText("٥٥١٢")).toBe("5512");
  });

  it("keeps what an email is made of", () => {
    expect(foldText("Sara.K+qa@Gmail.com")).toBe("sara.k+qa@gmail.com");
  });

  it("splits a query into words", () => {
    expect(searchTokens("  Ali   Ahmed ")).toEqual(["ali", "ahmed"]);
    expect(searchTokens("")).toEqual([]);
  });
});

describe("matching a row", () => {
  const row = {
    text: ["Ahmed Ali", "ahmed@example.com", "West Walk", "Judge"],
    phones: ["+974 5512 3456"],
    exact: [12],
  };

  it("matches everything for a blank query", () => {
    expect(matchesSearch("", row)).toBe(true);
    expect(matchesSearch("   ", row)).toBe(true);
  });

  it("finds every word, in any order", () => {
    expect(matchesSearch("ali ahmed", row)).toBe(true);
    expect(matchesSearch("ahmed walk", row)).toBe(true);
    expect(matchesSearch("ahmed pearl", row)).toBe(false);
  });

  it("finds part of an email or a gym", () => {
    expect(matchesSearch("ahmed@exa", row)).toBe(true);
    expect(matchesSearch("west", row)).toBe(true);
  });

  it("finds a phone by its digits, however it was typed", () => {
    expect(matchesSearch("55123456", row)).toBe(true);
    expect(matchesSearch("5512 3456", row)).toBe(true);
    expect(matchesSearch("٥٥١٢", row)).toBe(true);
  });

  it("matches a team number exactly, never as part of another", () => {
    expect(matchesSearch("12", row)).toBe(true);
    expect(matchesSearch("1", { text: ["Team"], exact: [12] })).toBe(false);
    expect(matchesSearch("120", { text: ["Team"], exact: [12] })).toBe(false);
  });

  it.each(["+97455123456", "+974 5512-3456", "(974) 5512.3456", "0097455123456", "+٩٧٤ ٥٥١٢-٣٤٥٦", "ahmed +97455123456"])("finds a pasted phone: %s", (query) => {
    expect(matchesSearch(query, row)).toBe(true);
    expect(matchesSearch(query, { text: ["Ahmed Ali"], phones: ["+974 5512 9999"] })).toBe(false);
  });

  it("accepts an international dialing prefix in the stored phone", () => {
    expect(matchesSearch("+97455123456", { text: [], phones: ["00974-5512-3456"] })).toBe(true);
  });

  it.each(["7746 4513", "7746", "٧٧٤٦", "+97477464513"])("finds a full or partial mobile number: %s", (query) => {
    expect(matchesSearch(query, { text: ["Waiting athlete", "waiting@example.com"], phones: ["+974 7746 4513"] })).toBe(true);
  });

  it("does not match a phone on one or two digits", () => {
    expect(matchesSearch("55", { text: ["x"], phones: ["55123456"] })).toBe(false);
  });

  it("finds Arabic names whatever the spelling", () => {
    const arabic = { text: ["أحمد مصطفى"] };
    expect(matchesSearch("احمد", arabic)).toBe(true);
    expect(matchesSearch("مصطفي احمد", arabic)).toBe(true);
  });
});
