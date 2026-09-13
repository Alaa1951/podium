import type { Category, Division } from "@/generated/prisma/enums";

// ─────────────────────────────────────────────────────────────────────────────
// The scoring engine, taken from the PODIUM Series 1 scoring table.
//
// Raw movement inputs come in; points and ranks are always DERIVED here and
// never stored, so correcting a formula re-scores the whole field at once.
//
// Shared by the server (board queries, exports) and the client (live preview
// while an operator types), so this module holds no secrets and no I/O.
// ─────────────────────────────────────────────────────────────────────────────

// BFT MENA's registration form is the authority on these two words:
// CATEGORY is who is competing, DIVISION is the level they compete at.
export const CATEGORIES: Category[] = ["Womens", "Mens", "Mixed"];
export const DIVISIONS: Division[] = ["Rookie", "Open", "Pro"];

/** The nine brackets, in board order: Womens Rookie … Mixed Pro. */
export const BRACKETS: { category: Category; division: Division }[] = CATEGORIES.flatMap((c) =>
  DIVISIONS.map((d) => ({ category: c, division: d }))
);

export function bracketIndex(category: Category, division: Division) {
  return CATEGORIES.indexOf(category) * 3 + DIVISIONS.indexOf(division);
}

export function bracketAt(index: number) {
  return BRACKETS[((index % 9) + 9) % 9];
}

/** "MENS · OPEN" — category first, the way the board reads it aloud. */
export function bracketLabel(category: Category, division: Division) {
  return `${category} ${division}`;
}

// The score itself — what a zone is, what a movement is worth, how a total is
// worked out — lives in zones.ts, driven by each series own definition. It used
// to live here as seven named fields, which could only ever describe Series 1.

/**
 * Whether a total sits far enough from its bracket's mean to be worth a second
 * look before it reaches the public board. Not a rejection — a prompt.
 */
export function isOutlier(total: number, peerTotals: number[], threshold = 0.4) {
  if (peerTotals.length < 2 || total <= 0) return false;
  const mean = peerTotals.reduce((a, b) => a + b, 0) / peerTotals.length;
  if (mean <= 0) return false;
  return Math.abs(total - mean) / mean > threshold;
}

export type Rankable = { id: string; total: number };
export type Ranked<T extends Rankable> = T & { rank: number };

/**
 * Descending by total. Equal totals share a rank and the next rank is skipped
 * (1, 2, 2, 4) — the scoring sheet defines no tie-break, so the board shows the
 * tie rather than inventing a winner.
 */
export function rankAll<T extends Rankable>(rows: T[]): Ranked<T>[] {
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  let lastTotal: number | null = null;
  let lastRank = 0;

  return sorted.map((row, i) => {
    const rank =
      lastTotal !== null && Math.abs(row.total - lastTotal) < 0.005 ? lastRank : i + 1;
    lastTotal = row.total;
    lastRank = rank;
    return { ...row, rank };
  });
}

/** en-US grouping with a fixed number of decimals — the board's number format. */
export function fmt(value: number, decimals: number) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Medal colours are the CSS brand tokens from globals.css (--gold/--silver/
// --bronze/--bft-ink), not literals, so the medals can never drift from the
// rank rails and discs that share the same metal. They are consumed only
// through inline styles, where var() resolves.
export const MEDALS: Record<number, { label: string; color: string; ink: string }> = {
  1: { label: "Gold", color: "var(--gold)", ink: "var(--bft-ink)" },
  2: { label: "Silver", color: "var(--silver)", ink: "var(--bft-ink)" },
  3: { label: "Bronze", color: "var(--bronze)", ink: "var(--bft-ink)" },
};

// ── Event-day timing ─────────────────────────────────────────────────────────

/** "09:00" + 40 → "09:40", wrapping at midnight. */
export function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = String(hhmm).split(":");
  let total = (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0) + minutes;
  total = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function countdown(msRemaining: number) {
  const ms = Math.max(0, msRemaining);
  return {
    days: String(Math.floor(ms / 86_400_000)).padStart(2, "0"),
    hours: String(Math.floor(ms / 3_600_000) % 24).padStart(2, "0"),
    minutes: String(Math.floor(ms / 60_000) % 60).padStart(2, "0"),
    seconds: String(Math.floor(ms / 1000) % 60).padStart(2, "0"),
  };
}

export function clockFromMs(msRemaining: number) {
  const secs = Math.max(0, Math.ceil(msRemaining / 1000));
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

// ── Name matching ────────────────────────────────────────────────────────────

/**
 * Case, spacing and punctuation are ignored so a competitor who signs up under
 * "omar haddad" is matched to the registration a studio typed as "Omar Haddad".
 */
export function normalizeName(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
