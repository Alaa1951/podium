"use client";

import { startTransition, useEffect, useMemo, useSyncExternalStore } from "react";

import { createScoreAutosaveQueue, type AutosaveResult, type ScorePatch } from "@/lib/score-autosave";

/** The writer is memoized by team/zone identity, so queued work cannot ever
 * move to a different team when a route changes. An optional identity starts
 * a fresh queue after a wave restart or an explicitly reopened entry. */
export function useScoreAutosave(write: (values: ScorePatch) => Promise<AutosaveResult>, identity?: string) {
  const { queue } = useMemo(() => ({ identity, queue: createScoreAutosaveQueue((values) => new Promise((resolve, reject) => {
    startTransition(async () => {
      try { resolve(await write(values)); }
      catch (error) { reject(error); }
    });
  })) }), [write, identity]);
  const state = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);

  useEffect(() => {
    queue.resume();
    const retry = () => { if (navigator.onLine) queue.retry(); };
    const visible = () => { if (document.visibilityState === "visible") retry(); };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", visible);
      queue.dispose();
    };
  }, [queue]);

  return { ...state, enqueue: queue.enqueue, flush: queue.flush, retry: queue.retry, terminate: queue.terminate };
}
