/** Every automatic page, bracket and floor-wave turn uses the same duration. */
export const BOARD_TURN_SECONDS = 15;

export type RotationStop = { id: number; pages: number };
export type RotationCursor = { id: number | null; page: number };

/** Keep the current stop when fresh scores add entries elsewhere in the cycle. */
export function resolveRotation(
  cursor: RotationCursor,
  stops: readonly RotationStop[],
  fallback: number | null = null,
): RotationCursor {
  const stop = stops.find((one) => one.id === cursor.id);
  if (!stop) return { id: stops[0]?.id ?? fallback, page: 0 };
  return { id: stop.id, page: Math.max(0, Math.min(cursor.page, stop.pages - 1)) };
}

/** Finish every page of a stop before advancing; wrap only at the cycle's end. */
export function moveRotation(
  cursor: RotationCursor,
  stops: readonly RotationStop[],
  direction: 1 | -1 = 1,
  fallback: number | null = null,
): RotationCursor {
  const current = resolveRotation(cursor, stops, fallback);
  const index = stops.findIndex((one) => one.id === current.id);
  if (index < 0) return current;
  const page = current.page + direction;
  if (page >= 0 && page < stops[index].pages) return { id: current.id, page };
  const next = stops[(index + direction + stops.length) % stops.length];
  return { id: next.id, page: direction === 1 ? 0 : next.pages - 1 };
}
