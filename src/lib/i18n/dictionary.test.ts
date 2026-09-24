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

describe("one key, one file", () => {
  /**
   * `AR` is a spread of eight dictionaries, so a key written in two of them
   * silently loses: whichever file is spread LAST wins, and the other Arabic
   * never renders anywhere. The merged object cannot show this — by the time
   * you can read `AR`, the loser is gone.
   *
   * It has already happened once. `"Waiting"` was written into ar-console.ts
   * for the CRM intake column while ar-mobile.ts already had it, and because
   * AR_MOBILE spreads later the console value was dead the day it was typed.
   * Nothing failed, nothing warned, and the column rendered the other word.
   */
  it("never gives one phrase two different translations", async () => {
    const files = {
      "ar-core": (await import("@/lib/i18n/ar-core")).AR_CORE,
      "ar-console": (await import("@/lib/i18n/ar-console")).AR_CONSOLE,
      "ar-results": (await import("@/lib/i18n/ar-results")).AR_RESULTS,
      "ar-notifications": (await import("@/lib/i18n/ar-notifications")).AR_NOTIFICATIONS,
      "ar-mobile": (await import("@/lib/i18n/ar-mobile")).AR_MOBILE,
      "ar-access": (await import("@/lib/i18n/ar-access")).AR_ACCESS,
      "ar-floor": (await import("@/lib/i18n/ar-floor")).AR_FLOOR,
      "ar-signup": (await import("@/lib/i18n/ar-signup")).AR_SIGNUP,
      "ar-wave-schedule": (await import("@/lib/i18n/ar-wave-schedule")).AR_WAVE_SCHEDULE,
    };

    // Only CONFLICTING duplicates are flagged. The same phrase written
    // identically in two files is redundant and harmless — whichever wins,
    // the screen reads the same. Two different values is the bug: one of them
    // never renders, and somebody wrote it believing it would.
    const seen = new Map<string, { file: string; value: string }>();
    const clashes: string[] = [];
    for (const [file, phrases] of Object.entries(files)) {
      for (const [key, value] of Object.entries(phrases)) {
        const first = seen.get(key);
        if (!first) {
          seen.set(key, { file, value });
          continue;
        }
        if (first.value !== value) {
          clashes.push(`"${key}" — ${first.file} says "${first.value}", ${file} says "${value}"`);
        }
      }
    }

    // KNOWN, AND NOT BLESSED. Each of these already renders the second value
    // everywhere, because AR_MOBILE and AR_SIGNUP are spread last. Three are
    // the wrong WORD rather than a different wording, and the list says which:
    //
    //   "Place"      results mean the RANK; "المكان" is a location, and it is
    //                what the results table actually renders today.
    //   "submitted"  the console means a score was SENT; "محفوظ" says saved.
    //   "Signed up"  one file means self-registration, the other means a DATE.
    //
    // The fix is per-screen and sometimes means splitting the English key,
    // which is a change of its own. This list exists so the debt is counted
    // and, more importantly, so it cannot grow: a NEW conflict fails here.
    const known = [
      '"submitted" — ar-console says "مُرسلة", ar-mobile says "محفوظ"',
      '"Place" — ar-results says "المركز", ar-mobile says "المكان"',
      '"Submitted" — ar-mobile says "تم إرسال النتيجة", ar-floor says "تم الإرسال"',
      '"Open" — ar-core says "مفتوح", ar-floor says "مفتوحة"',
      '"Phone" — ar-console says "رقم الهاتف", ar-signup says "الهاتف"',
      '"Signed up" — ar-mobile says "تسجيل ذاتي", ar-signup says "تاريخ التسجيل"',
      '"New studio name" — ar-core says "اسم استوديو جديد", ar-signup says "اسم الاستوديو الجديد"',
      '"That email does not look right." — ar-results says "هذا البريد لا يبدو صحيحًا.", ar-signup says "هذا البريد الإلكتروني غير صحيح."',
    ];

    expect(clashes.filter((clash) => !known.includes(clash))).toEqual([]);
    // And the list shrinks or stays; it never quietly grows.
    expect(clashes.length).toBeLessThanOrEqual(known.length);
  });
});
