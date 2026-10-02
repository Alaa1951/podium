"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { BOARD_TURN_SECONDS, moveRotation, resolveRotation } from "@/lib/board-rotation";
import type { RotationCursor, RotationStop } from "@/lib/board-rotation";

/** Score polls update the next turn's inputs without restarting its timer. */
export function useBoardRotation(
  stops: readonly RotationStop[],
  enabled = true,
  fallback: number | null = null,
) {
  const [stored, setStored] = useState<RotationCursor>(() =>
    resolveRotation({ id: null, page: 0 }, stops, fallback),
  );
  const [restartVersion, setRestartVersion] = useState(0);
  const cursor = resolveRotation(stored, stops, fallback);

  // Remember the first result so adding an earlier category cannot interrupt it.
  if (stored.id !== cursor.id || stored.page !== cursor.page) setStored(cursor);

  const tick = useEffectEvent(() => {
    setStored((current) => moveRotation(current, stops, 1, fallback));
  });
  const hasStops = stops.length > 0;
  useEffect(() => {
    if (!enabled || !hasStops) return;
    const timer = setInterval(() => tick(), BOARD_TURN_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [enabled, hasStops, restartVersion]);

  function restart(nextStops: readonly RotationStop[] = stops, nextFallback = fallback) {
    setStored(resolveRotation({ id: null, page: 0 }, nextStops, nextFallback));
    setRestartVersion((version) => version + 1);
  }

  function turn(direction: 1 | -1) {
    setStored(moveRotation(cursor, stops, direction, fallback));
    setRestartVersion((version) => version + 1);
  }

  return { cursor, restart, turn };
}
