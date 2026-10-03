export type ScorePatch = Record<string, number | null>;
export type AutosaveResult = { ok: true; revision?: string } | { ok: false; error: string };
export type AutosaveState = { dirty: boolean; saving: boolean; saved: boolean; error: string | null; revision: string | null };

/** A successful save or newer poll makes older score snapshots obsolete.
 * Undefined supports callers without revision metadata; null is a known
 * snapshot with no score yet and must not replace an acknowledged save. */
export function isCurrentScoreSnapshot(
  revision: string | null | undefined,
  acceptedRevision?: string | null,
  savedRevision?: string | null,
): boolean {
  if (revision === undefined) return true;
  const stamp = (value: string | null | undefined) => value ? Date.parse(value) : 0;
  return stamp(revision) >= Math.max(stamp(acceptedRevision), stamp(savedRevision));
}

/** One request at a time. Later edits replace queued values, never an in-flight
 * request, and only changed fields are sent so another judge's work survives. */
export function createScoreAutosaveQueue(write: (values: ScorePatch) => Promise<AutosaveResult>) {
  let queued: ScorePatch = {};
  let running = false;
  let disposed = false;
  let terminalError: string | null = null;
  let revision: string | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let state: AutosaveState = { dirty: false, saving: false, saved: false, error: null, revision };
  const listeners = new Set<() => void>();
  const waiters = new Set<(saved: boolean) => void>();

  const publish = (next: Omit<AutosaveState, "revision">) => {
    state = { ...next, revision };
    listeners.forEach((listener) => listener());
  };
  const settle = (saved: boolean) => {
    waiters.forEach((resolve) => resolve(saved));
    waiters.clear();
  };
  const clearRetry = () => {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  async function drain() {
    if (running || disposed || terminalError || !Object.keys(queued).length) return;
    clearRetry();
    running = true;
    publish({ dirty: true, saving: true, saved: false, error: null });
    while (!disposed && !terminalError && Object.keys(queued).length) {
      const batch = queued;
      queued = {};
      let result: AutosaveResult;
      let networkFailure = false;
      try {
        result = await write(batch);
      } catch {
        result = { ok: false, error: "NETWORK_ERROR" };
        networkFailure = true;
      }
      if (!result.ok) {
        // A newer tap on a failed field always wins over its older request.
        queued = { ...batch, ...queued };
        running = false;
        if (!disposed) {
          publish({ dirty: true, saving: false, saved: false, error: terminalError ?? result.error });
          if (networkFailure && !terminalError) {
            const delay = Math.min(1000 * 2 ** failures++, 10_000);
            retryTimer = setTimeout(() => { retryTimer = undefined; void drain(); }, delay);
          }
        }
        settle(false);
        return;
      }
      if (result.revision && isCurrentScoreSnapshot(result.revision, revision)) {
        revision = result.revision;
        if (!disposed) publish(state);
      }
      failures = 0;
    }
    running = false;
    if (!disposed) {
      const dirty = Object.keys(queued).length > 0;
      publish({ dirty, saving: false, saved: !dirty, error: terminalError });
      settle(!dirty);
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    enqueue(values: ScorePatch) {
      if (disposed || terminalError || !Object.keys(values).length) return;
      queued = { ...queued, ...values };
      publish({ dirty: true, saving: running, saved: false, error: null });
      void drain();
    },
    /** Submission and Back wait for the latest tap, including queued edits. */
    flush(): Promise<boolean> {
      if (disposed || terminalError) return Promise.resolve(false);
      if (!running && !Object.keys(queued).length) return Promise.resolve(true);
      return new Promise((resolve) => {
        waiters.add(resolve);
        void drain();
      });
    },
    retry() { void drain(); },
    /** A clock or revoked post is final for this card. Keep failed drafts
     * visible, but never retry them on reconnect or effect remount. */
    terminate(error: string) {
      terminalError = error;
      clearRetry();
      publish({ ...state, saving: running, saved: !state.dirty, error });
      settle(false);
    },
    resume() { disposed = false; void drain(); },
    dispose() {
      disposed = true;
      clearRetry();
      settle(false);
    },
  };
}
