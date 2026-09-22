// ─────────────────────────────────────────────────────────────────────────────
// THE CRM FIELD MAP.
//
// WHY THESE ARE IDS AND NOT NAMES OR KEYS, which is the whole point of this
// file. GoHighLevel gives every custom field three identifiers, and in this
// account two of the three lie:
//
//   id     sHHLKhhvqLxQhyf9u3fD
//   name   "Team Name"                      ← correct
//   key    contact.contactname_member_2_qab_copy   ← says "name member 2"
//
// That field really is the team name. Its key carries the history of having
// been made by copying the member-2 name field, and GHL never renames a key.
// So a lookup by key would read the team name into the partner's name.
//
// And a lookup by NAME is no safer, because two pairs differ only by a double
// space: "BFT member" / "BFT  member", "BFT studio" / "BFT  studio". Those are
// not duplicates — the second of each pair belongs to MEMBER 2 (its key says
// so). A trim-and-compare would merge them and write one person's studio onto
// the other.
//
// The id is the only identifier that is both stable and unambiguous. It also
// cannot be checked by reading the CRM UI, so every entry below was confirmed
// against the live field list on 22 September 2026 and must be re-confirmed by
// a human if the form changes. `assertFieldMap` fails loudly when an id stops
// existing, because the silent version of that failure is a sync that reads
// every affected field as empty and quietly blanks it.
//
// MEMBER 1 IS NOT IN HERE. Their name, email, phone and date of birth are the
// contact's own columns. Only member 2 lives in custom fields.
// ─────────────────────────────────────────────────────────────────────────────

/** One custom field as the CRM returns it on a contact. */
export type CrmCustomField = { id: string; value: unknown };

/** The subset of a GHL contact this integration reads. */
export type CrmContact = {
  id: string;
  contactName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  tags?: string[];
  customFields?: CrmCustomField[];
};

/**
 * Field id → what it means. Confirmed against the live CRM, not guessed.
 * The comment on each line is the field's DISPLAY name, so this table can be
 * read next to the CRM UI.
 */
export const FIELD = {
  teamName: "sHHLKhhvqLxQhyf9u3fD", // "Team Name"        (key says name_member_2)
  category: "TW97iZJsRwlQ1M9jOjOk", // "Category"
  division: "EUQDhBXpwaZlxgJQAMnr", // "Division"
  havePartner: "dzy1w8HEvQAD0HjMcsmc", // "have_partner"

  // ── Member 1 ──────────────────────────────────────────────────────────────
  genderOne: "HiP5NvLfey7occKXRtcX", // "gender_member_1"
  shirtOne: "qWk9xcyZoASWmRFuXKj7", // "t_shirt_size_member_1"
  bftMemberOne: "hf1t2fRLO3EjhwmrZwQp", // "BFT member"     (single space)
  studioOne: "NPrRAAZWXCA4Ku79NvI3", // "BFT studio"     (single space)

  // ── Member 2 ──────────────────────────────────────────────────────────────
  nameTwo: "NVBBnkQOeiMlYUUFG4ei", // "name member 2"
  emailTwo: "kyYBUYyXGyZQNXznWWoS", // "Email member 2"
  phoneTwo: "3Oj28sDf0jhcuRRr1PEY", // "Phone member 2"
  birthTwo: "PMNtJBHYJC8wXbXyozif", // "Date  of birth"
  genderTwo: "FhlBk5jNgkUxXhT6kWWC", // "gender_member_2"
  shirtTwo: "w0mLKYwtb4cypkPeGt6s", // "t_shirt_size_member_2"
  bftMemberTwo: "L0SeVWnn742UP9lo8dsG", // "BFT  member"    (DOUBLE space)
  studioTwo: "l6R1LhYS1yH5C8LVGoBP", // "BFT  studio"    (DOUBLE space)

  // ── Money ─────────────────────────────────────────────────────────────────
  paidAmount: "oQkKeehHT7cxx6lqy00N", // "podium_paid_amount"
  invoice: "wyUqst9FogDb5vmBZry5", // "podium_invoice"
} as const;

/**
 * The fields a contact CANNOT become a team without.
 *
 * Kept separate from FIELD because the rest are allowed to be missing — half
 * the CRM's records have no shirt size and they still register fine.
 */
export const REQUIRED_FIELD_IDS: readonly string[] = [FIELD.category, FIELD.division];

/**
 * Fail loudly if the CRM no longer has a field this map names.
 *
 * Without this, a field deleted or rebuilt in the form makes every read of it
 * return undefined — and the sync would go on writing teams with that value
 * blanked, one poll at a time, with nothing in any log.
 */
export function assertFieldMap(remoteFieldIds: readonly string[]): void {
  const present = new Set(remoteFieldIds);
  const missing = Object.entries(FIELD)
    .filter(([, id]) => !present.has(id))
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`CRM custom fields are missing or renamed: ${missing.join(", ")}`);
  }
}

/** Read one custom field off a contact. GHL wraps single choices in an array. */
export function readField(contact: CrmContact, id: string): string | null {
  const found = contact.customFields?.find((field) => field.id === id);
  if (!found) return null;
  const raw = Array.isArray(found.value) ? found.value[0] : found.value;
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  return text.length ? text : null;
}
