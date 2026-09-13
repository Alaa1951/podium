"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { DEFAULT_LOCALE, dirFor, type Locale } from "@/lib/i18n/config";
import { createTranslator, type Translator } from "@/lib/i18n/dictionary";

type LocaleContextValue = { locale: Locale; dir: "ltr" | "rtl"; t: Translator };

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  dir: "ltr",
  t: createTranslator(DEFAULT_LOCALE),
});

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(
    () => ({ locale, dir: dirFor(locale), t: createTranslator(locale) }),
    [locale]
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

/** Shorthand for the common case — `const t = useT()`. */
export function useT() {
  return useContext(LocaleContext).t;
}
