// Every wall-clock time in this app belongs to Qatar: schedule fields are
// entered, stored and displayed as Qatar time, whatever timezone the server
// itself happens to run in. Display goes through the named zone; parsing
// states the offset directly, which is what Asia/Qatar resolves to all year
// (UTC+3, no daylight saving).

export const QATAR_TIME_ZONE = "Asia/Qatar";

const qatarParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: QATAR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function qatarWall(date: Date) {
  const parts: Record<string, string> = {};
  for (const part of qatarParts.formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

/**
 * Parse a datetime-local value ("2026-10-03T09:00", optionally with seconds,
 * or a bare date) as QATAR wall time — never the server's timezone. Naive
 * strings handed to `new Date` are read in the server's local zone, which on
 * a UTC server turns 02:00 into 05:00 Qatar.
 */
export function parseQatarWallTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2] ?? "00:00"}+03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The value a datetime-local input expects: the instant as Qatar wall time. */
export function formatQatarForInput(date: Date | null | undefined): string {
  if (!date) return "";
  const parts = qatarWall(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** The instant's calendar day in Qatar — "YYYY-MM-DD". */
export function formatQatarDayKey(date: Date | string): string {
  const parts = qatarWall(new Date(date));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** "2026-10-03 09:20" — short, sortable, and the same in every locale. */
export function formatQatarDateTime(date: Date | string): string {
  const parts = qatarWall(new Date(date));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
