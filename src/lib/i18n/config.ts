export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "podium_locale";

export const LOCALE_META: Record<Locale, { label: string; dir: "ltr" | "rtl"; htmlLang: string }> = {
  en: { label: "English", dir: "ltr", htmlLang: "en" },
  ar: { label: "العربية", dir: "rtl", htmlLang: "ar" },
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

export function dirFor(locale: Locale) {
  return LOCALE_META[locale].dir;
}
