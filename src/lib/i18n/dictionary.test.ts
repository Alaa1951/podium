/**
 * The translation contract: an untranslated key must render as correct English
 * rather than as a placeholder or an empty string, because half the interface
 * is written by whoever adds a screen next.
 */
import { describe, expect, it } from "vitest";

import { dirFor, isLocale, LOCALES, LOCALE_META } from "@/lib/i18n/config";
import { AR, createTranslator } from "@/lib/i18n/dictionary";

describe("locales", () => {
  it("offers English and Arabic", () => {
    expect(LOCALES).toEqual(["en", "ar"]);
  });

  it("puts Arabic right-to-left and English left-to-right", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
    expect(LOCALE_META.ar.htmlLang).toBe("ar");
  });

  it("rejects anything that is not a supported locale", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale("")).toBe(false);
  });
});

describe("the translator", () => {
  it("returns the key itself in English", () => {
    const t = createTranslator("en");
    expect(t("Sign in")).toBe("Sign in");
    expect(t("A phrase nobody has translated")).toBe("A phrase nobody has translated");
  });

  it("returns the Arabic where there is one", () => {
    const t = createTranslator("ar");
    expect(t("Sign in")).toBe("تسجيل الدخول");
  });

  it("falls back to readable English for a missing Arabic key", () => {
    const t = createTranslator("ar");
    expect(t("A phrase nobody has translated")).toBe("A phrase nobody has translated");
  });

  it("interpolates named values", () => {
    const t = createTranslator("en");
    expect(t("Runs on {minutes}-minute waves.", { minutes: 20 })).toBe(
      "Runs on 20-minute waves."
    );
  });

  it("leaves an unknown placeholder alone rather than printing undefined", () => {
    const t = createTranslator("en");
    expect(t("Hello {name}", {})).toBe("Hello {name}");
  });
});

describe("the Arabic dictionary", () => {
  it("has no empty translations", () => {
    const empty = Object.entries(AR).filter(([, value]) => !value.trim());
    expect(empty).toEqual([]);
  });

  it("actually translates — a value equal to its key is a missed string", () => {
    // A handful of terms are the same in both languages (proper nouns and the
    // brand), and those are listed explicitly rather than waved through.
    const intentionallyIdentical = new Set(["BFT MENA"]);
    const untranslated = Object.entries(AR)
      .filter(([key, value]) => key === value && !intentionallyIdentical.has(key))
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });

  it("keeps every placeholder a key uses", () => {
    for (const [key, value] of Object.entries(AR)) {
      const inKey = (key.match(/\{(\w+)\}/g) ?? []).sort();
      const inValue = (value.match(/\{(\w+)\}/g) ?? []).sort();
      expect({ key, inValue }).toEqual({ key, inValue: inKey });
    }
  });
});
