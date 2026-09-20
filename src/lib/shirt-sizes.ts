/**
 * The event shirt sizes, in order, in one place.
 *
 * The server's validation and the form's dropdown read the same list, so a
 * size the form offers can never be one the action rejects. Pure — no secrets
 * and no Prisma client — so a client component may import it.
 *
 * The order is the order they are shown in; it is also smallest-first, which
 * is how the order sheet for the printer wants them counted.
 */
export const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

export type ShirtSizeValue = (typeof SHIRT_SIZES)[number];
