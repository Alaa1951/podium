// ─────────────────────────────────────────────────────────────────────────────
// ONE SEARCH, EVERY LIST.
//
// Finding a person in a list of hundreds has to forgive the way people type:
//
//   • every word counts, in any order — "ali ahmed" finds "Ahmed Ali";
//   • case, accents and Arabic spelling variants don't matter — أحمد, إحمد
//     and احمد are the same; ة/ه, ى/ي, ؤ/و, ئ/ي too; tashkeel and tatweel
//     are ignored; Arabic-Indic digits are digits;
//   • a phone number matches whatever spacing or +974 it was stored with;
//   • a number on its own matches a team number exactly (12 is not 120).
//
// Pure: the Users screen filters in the browser, the Athletes screen on the
// server, and both ask this.
// ─────────────────────────────────────────────────────────────────────────────

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Text reduced to what a search compares: see the rules above. */
export function foldText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .toLowerCase()
    .normalize("NFKD")
    // Combining marks: Latin accents, Arabic tashkeel and the hamza that
    // NFKD splits off أ / إ / ؤ / ئ.
    .replace(/\p{M}/gu, "")
    .replace(/ـ/g, "") // tatweel
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    // Keep what emails and names are made of; anything else separates words.
    .replace(/[^\p{Letter}\p{Number}@.+_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The words of a query, folded. Empty for a blank query. */
export function searchTokens(query: string | null | undefined): string[] {
  const folded = foldText(query);
  return folded ? folded.split(" ") : [];
}

const digitsOnly = (value: string) => value.replace(/\D/g, "");

export type SearchFields = {
  /** Names, emails, team and gym names, role labels — matched by containment. */
  text: (string | null | undefined)[];
  /** Phone numbers — matched on digits alone. */
  phones?: (string | null | undefined)[];
  /** Values a number-only word must equal exactly (a team number). */
  exact?: (string | number | null | undefined)[];
};

/**
 * Whether a row matches: EVERY word of the query must be found in some field.
 * A blank query matches everything.
 */
export function matchesSearch(query: string | null | undefined, fields: SearchFields): boolean {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const text = fields.text.map(foldText).filter(Boolean);
  const phones = (fields.phones ?? []).map((phone) => digitsOnly(foldText(phone))).filter(Boolean);
  const exact = (fields.exact ?? []).filter((value) => value !== null && value !== undefined).map((value) => String(value));

  return tokens.every((token) => {
    if (text.some((field) => field.includes(token))) return true;
    if (/^\d+$/.test(token)) {
      if (exact.includes(token)) return true;
      // Three digits or more before a phone is worth matching: "4" would
      // match every number in Qatar.
      if (token.length >= 3 && phones.some((phone) => phone.includes(token))) return true;
    }
    return false;
  });
}
