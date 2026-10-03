export type ScorePatch = Record<string, number | null>;
export type AutosaveResult = { ok: true } | { ok: false; error: string };
export type AutosaveState = { dirty: boolean; saving: boolean; saved: boolean; error: string | null };

/** One request at a time. Later edits replace queued values, never an in-flight
 * request, and only changed fields are sent so another judge's work survives. */
export function createScoreAutosaveQueue(write: (values: ScorePatch) => Promise<AutosaveResult>) {
  let queued: ScorePatch = {};
  let running = false;
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let state: AutosaveState = { dirty: false, saving: false, saved: false, error: null };
  const listeners = new Set<() => void>();
  const waiters = new Set<(saved: boolean) => void>();

  const publish = (next: AutosaveState) => {
    state = next;
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
    if (running || disposed || !Object.keys(queued).length) return;
    clearRetry();
    running = true;
    publish({ dirty: true, saving: true, saved: false, error: null });
    while (!disposed && Object.keys(queued).length) {
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
          publish({ dirty: true, saving: false, saved: false, error: result.error });
          if (networkFailure) {
            const delay = Math.min(1000 * 2 ** failures++, 10_000);
            retryTimer = setTimeout(() => { retryTimer = undefined; void drain(); }, delay);
          }
        }
        settle(false);
        return;
      }
      failures = 0;
    }
    running = false;
    if (!disposed) {
      const dirty = Object.keys(queued).length > 0;
      publish({ dirty, saving: false, saved: !dirty, error: null });
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
      if (disposed || !Object.keys(values).length) return;
      queued = { ...queued, ...values };
      publish({ dirty: true, saving: running, saved: false, error: null });
      void drain();
    },
    /** Submission and Back wait for the latest tap, including queued edits. */
    flush(): Promise<boolean> {
      if (disposed) return Promise.resolve(false);
      if (!running && !Object.keys(queued).length) return Promise.resolve(true);
      return new Promise((resolve) => {
        waiters.add(resolve);
        void drain();
      });
    },
    retry() { void drain(); },
    resume() { disposed = false; void drain(); },
    dispose() {
      disposed = true;
      clearRetry();
      settle(false);
    },
  };
}
