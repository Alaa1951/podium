import { FIELD, readField, type CrmContact } from "@/lib/crm/field-map";

// ─────────────────────────────────────────────────────────────────────────────
// TRANSLATING THE CRM's WORDS INTO PODIUM's.
//
// Every function here returns null rather than a guess. That is the rule the
// whole integration rests on: a record we cannot read correctly is skipped and
// reported, never imported with a plausible-looking default. `Division` in
// particular decides the PRESCRIBED LOADS a pair lifts (LoadStandard is keyed
// on [division, sex]), so a guess here is a team given the wrong weights on
// the floor — and nobody finds that out until the morning.
//
// The mappings are not case conversions. "MEN" → "Mens" and "WOMEN" →
// "Womens" gain a letter; a toLowerCase/capitalise would produce "Men" and
// "Women", which are not members of the enum and would fail at the database
// instead of here.
// ─────────────────────────────────────────────────────────────────────────────

export type Category = "Mens" | "Womens" | "Mixed";
export type Division = "Rookie" | "Open" | "Pro";
export type ShirtSize = "XS" | "S" | "M" | "L" | "XL" | "XXL";

const CATEGORIES: Record<string, Category> = {
  MEN: "Mens",
  WOMEN: "Womens",
  MIXED: "Mixed",
};

const DIVISIONS: Record<string, Division> = {
  ROOKIE: "Rookie",
  OPEN: "Open",
  PRO: "Pro",
};

const SHIRTS: Record<string, ShirtSize> = {
  XS: "XS",
  S: "S",
  M: "M",
  L: "L",
  XL: "XL",
  XXL: "XXL",
};

export function toCategory(raw: string | null): Category | null {
  return raw ? (CATEGORIES[raw.trim().toUpperCase()] ?? null) : null;
}

export function toDivision(raw: string | null): Division | null {
  return raw ? (DIVISIONS[raw.trim().toUpperCase()] ?? null) : null;
}

export function toShirtSize(raw: string | null): ShirtSize | null {
  return raw ? (SHIRTS[raw.trim().toUpperCase()] ?? null) : null;
}

/**
 * The studio a competitor belongs to, as PODIUM names it.
 *
 * The CRM's options carry a "BFT " prefix and sometimes a gendered suffix —
 * "BFT West Walk  Female" and "BFT West Walk  Male" are the same studio with
 * two doors. Both must land on "West Walk".
 *
 * Returns null when nothing matches, and null is a real answer here: a
 * competitor who belongs to no studio is allowed, common, and a figure the
 * reports are asked for. Inventing a studio would corrupt that number.
 */
export function toStudioName(raw: string | null, known: readonly string[]): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^BFT\s+/i, "").replace(/\s+(male|female)$/i, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const hit = known.find((name) => name.toLowerCase() === cleaned.toLowerCase());
  return hit ?? null;
}

/**
 * A GHL checkbox arrives as an array of the ticked labels, so any entry means
 * ticked. An unticked box is an empty array or the field is absent entirely.
 */
export function toBftMember(raw: string | null): boolean {
  return raw !== null && raw.length > 0;
}

/** A GHL date field is epoch milliseconds; the contact's own is an ISO string. */
export function toDate(raw: string | null): Date | null {
  if (!raw) return null;
  const asNumber = Number(raw);
  const parsed = Number.isFinite(asNumber) && raw.trim() !== "" ? new Date(asNumber) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Minor units, so an amount is never a float. "250.50" → 25050. */
export function toMinorUnits(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** Member 1's name, from whichever of the contact's name columns is filled. */
export function contactFullName(contact: CrmContact): string | null {
  const joined = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  const name = (contact.contactName ?? "").trim() || joined;
  return name.length ? name : null;
}

/** Member 2's name, which lives in a custom field. */
export function partnerFullName(contact: CrmContact): string | null {
  return readField(contact, FIELD.nameTwo);
}
