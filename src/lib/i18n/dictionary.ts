import type { Locale } from "@/lib/i18n/config";

// Keys are the English source string, so an untranslated key still renders as
// correct English rather than a placeholder. Add an Arabic value here and the
// string switches everywhere it is used.
import { AR_CONSOLE } from "@/lib/i18n/ar-console";
import { AR_CORE } from "@/lib/i18n/ar-core";
import { AR_RESULTS } from "@/lib/i18n/ar-results";
import { AR_NOTIFICATIONS } from "@/lib/i18n/ar-notifications";
import { AR_MOBILE } from "@/lib/i18n/ar-mobile";
import { AR_ACCESS } from "@/lib/i18n/ar-access";
import { AR_FLOOR } from "@/lib/i18n/ar-floor";
import { AR_SIGNUP } from "@/lib/i18n/ar-signup";
import { AR_WAVE_SCHEDULE } from "@/lib/i18n/ar-wave-schedule";

/**
 * The Arabic table, assembled from three.
 *
 * One file per area rather than one long scroll — a phrase is found by knowing
 * which screen it is on, which is how anybody looks for it.
 */
export const AR: Record<string, string> = { ...AR_CORE, ...AR_CONSOLE, ...AR_RESULTS, ...AR_NOTIFICATIONS, ...AR_MOBILE, ...AR_ACCESS, ...AR_FLOOR, ...AR_SIGNUP,
  ...AR_WAVE_SCHEDULE,
  More: "المزيد", Back: "رجوع", "My team": "فريقي", "My wave": "موجتي",
  "You have unsaved changes. Leave this screen?": "لديك تعديلات غير محفوظة. هل تريد مغادرة الشاشة؟",
  "You are offline. Reconnect to save changes.": "أنت غير متصل. اتصل بالإنترنت لحفظ التعديلات.",
  "View details": "عرض التفاصيل", "Contact": "بيانات الاتصال",
  Filters: "الفلاتر", Done: "تم", "Start time": "موعد البداية", Venue: "المكان",
};


const DICTIONARIES: Record<Locale, Record<string, string>> = { en: {}, ar: AR };

export type Translator = (key: string, vars?: Record<string, string | number>) => string;

function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

export function createTranslator(locale: Locale): Translator {
  const dict = DICTIONARIES[locale] ?? {};
  return (key, vars) => interpolate(dict[key] ?? key, vars);
}
