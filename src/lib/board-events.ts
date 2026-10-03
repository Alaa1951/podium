import "server-only";

type BoardEvents = {
  epoch: number;
  revisions: Map<string, number>;
  listeners: Map<string, Set<(revision: number) => void>>;
};

// Server Actions and Route Handlers can be compiled into separate bundles.
// They still share this Node process; module-local state would miss changes.
const processState = globalThis as typeof globalThis & { podiumBoardEvents?: BoardEvents };
const events = processState.podiumBoardEvents ??= {
  epoch: 0,
  revisions: new Map(),
  listeners: new Map(),
};

/** Invalidates every cached alias, including a slug whose ID is not yet known. */
export function boardCacheEpoch() {
  return events.epoch;
}

export function boardRevision(seriesId: string) {
  return events.revisions.get(seriesId) ?? 0;
}

/** Call only after the database transaction has committed. */
export function notifyBoardChanged(seriesId: string) {
  events.epoch++;
  const revision = boardRevision(seriesId) + 1;
  events.revisions.set(seriesId, revision);
  for (const listener of events.listeners.get(seriesId) ?? []) {
    // A disconnected wall must never make a committed score appear to fail.
    try { listener(revision); } catch { /* Its stream cleans up on disconnect. */ }
  }
}

export function subscribeBoardChanges(seriesId: string, listener: (revision: number) => void) {
  const listeners = events.listeners.get(seriesId) ?? new Set();
  listeners.add(listener);
  events.listeners.set(seriesId, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) events.listeners.delete(seriesId);
  };
}
