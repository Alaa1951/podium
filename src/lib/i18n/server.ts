import "server-only";

import { cookies } from "next/headers";

import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/dictionary";

/** The locale for this request, from the cookie the switcher writes. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getTranslator() {
  const locale = await getLocale();
  return { locale, t: createTranslator(locale) };
}
