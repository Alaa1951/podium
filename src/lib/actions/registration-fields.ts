import { z } from "zod";

/**
 * The field shapes a registration is built from.
 *
 * Shared by the intake form and the payment screen so the two cannot disagree
 * about what an empty box means, or about how "250" becomes an amount.
 */

/**
 * Absent, empty and whitespace all mean "not given".
 *
 * `.optional()` is what lets the KEY be missing — a union that merely accepts
 * `undefined` does not, which is a difference that costs an afternoon to find.
 */
export const optionalText = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    const text = (value ?? "").toString().trim();
    return text === "" ? null : text;
  });

/** "250" or "250.00" as typed → 25000 minor units. Never a float. */
export function toMinor(amount: string | null) {
  if (amount === null) return null;
  const value = Number(amount.replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** A date from a form field, or null if it cannot be read as one. */
export function toDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** One of the two people on a team, as the registration form submits them. */
export const personSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: optionalText,
  email: optionalText.refine(
    (value) => value === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
    "INVALID_EMAIL"
  ),
  dateOfBirth: optionalText,
  /** The BFT studio this person is a member of, or null for a non-member. */
  studioId: optionalText,
});
