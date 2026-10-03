import { afterEach, describe, expect, it, vi } from "vitest";

import { createScoreAutosaveQueue, isCurrentScoreSnapshot, type AutosaveResult } from "@/lib/score-autosave";

const deferred = () => {
  let resolve!: (result: AutosaveResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AutosaveResult>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
afterEach(() => { vi.useRealTimers(); });

describe("live score autosave", () => {
  it("stops reconnect retries at a deadline while keeping the unsaved value visible", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockRejectedValue(new Error("offline"));
    const queue = createScoreAutosaveQueue(write);
    queue.enqueue({ reps: 42 });
    await Promise.resolve();
    queue.terminate("ZONE_ENTRY_CLOSED");
    await vi.advanceTimersByTimeAsync(30_000);
    queue.retry();
    queue.resume();
    queue.enqueue({ reps: 43 });
    expect(await queue.flush()).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
    expect(queue.getSnapshot()).toMatchObject({ dirty: true, error: "ZONE_ENTRY_CLOSED", saving: false });
  });

  it("finishes an accepted in-flight request but never sends the queued value after closure", async () => {
    const first = deferred();
    const write = vi.fn().mockReturnValue(first.promise);
    const queue = createScoreAutosaveQueue(write);
    queue.enqueue({ reps: 4 });
    queue.enqueue({ reps: 5 });
    const flushed = queue.flush();
    queue.terminate("ZONE_ENTRY_CLOSED");
    expect(await flushed).toBe(false);
    first.resolve({ ok: true });
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    expect(queue.getSnapshot()).toMatchObject({ dirty: true, saved: false, error: "ZONE_ENTRY_CLOSED" });
  });
  it("starts immediately, serializes rapid taps and coalesces only changed fields", async () => {
    const first = deferred();
    const last = deferred();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    const queue = createScoreAutosaveQueue(write);
    queue.enqueue({ reps: 1 });
    expect(write).toHaveBeenCalledWith({ reps: 1 });
    queue.enqueue({ reps: 2 });
    queue.enqueue({ metres: 1200 });
    queue.enqueue({ reps: 3 });
    expect(write).toHaveBeenCalledTimes(1);
    const flush = queue.flush();
    first.resolve({ ok: true });
    await Promise.resolve();
    expect(write).toHaveBeenLastCalledWith({ reps: 3, metres: 1200 });
    expect(queue.getSnapshot()).toMatchObject({ dirty: true, saving: true });
    last.resolve({ ok: true });
    expect(await flush).toBe(true);
    expect(queue.getSnapshot()).toEqual({ dirty: false, saving: false, saved: true, error: null, revision: null });
  });

  it("keeps the latest edit after a lost response and retries the absolute value", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
    const queue = createScoreAutosaveQueue(write);
    queue.enqueue({ reps: 1, minutes: 0 });
    queue.enqueue({ reps: 2, seconds: 19 });
    const flush = queue.flush();
    first.reject(new Error("offline"));
    expect(await flush).toBe(false);
    expect(queue.getSnapshot()).toMatchObject({ dirty: true, error: "NETWORK_ERROR" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenLastCalledWith({ reps: 2, minutes: 0, seconds: 19 });
    expect(queue.getSnapshot()).toMatchObject({ dirty: false, saved: true });
  });

  it("shows validation refusals without a retry loop and allows a corrected edit", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValueOnce({ ok: false, error: "INVALID_SCORE" }).mockResolvedValue({ ok: true });
    const queue = createScoreAutosaveQueue(write);
    queue.enqueue({ reps: -1 });
    await Promise.resolve();
    expect(queue.getSnapshot()).toMatchObject({ dirty: true, error: "INVALID_SCORE" });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(write).toHaveBeenCalledTimes(1);
    queue.enqueue({ reps: 0 });
    expect(await queue.flush()).toBe(true);
    expect(write).toHaveBeenLastCalledWith({ reps: 0 });
  });

  it("flush retries a failed patch and waits before allowing navigation", async () => {
    const write = vi.fn().mockResolvedValueOnce({ ok: false, error: "FORBIDDEN" }).mockResolvedValue({ ok: true });
    const queue = createScoreAutosaveQueue(write);
    queue.enqueue({ reps: null });
    await Promise.resolve();
    expect(await queue.flush()).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith({ reps: null });
  });

  it("clears retries on disposal and can resume after an effect remount", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true });
    const queue = createScoreAutosaveQueue(write);
    queue.enqueue({ reps: 4 });
    await Promise.resolve();
    queue.dispose();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(await queue.flush()).toBe(false);
    queue.resume();
    expect(await queue.flush()).toBe(true);
  });

  it("rejects a delayed pre-save snapshot after rapid counter writes have settled", async () => {
    const first = deferred();
    const last = deferred();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise).mockResolvedValue({ ok: true });
    const queue = createScoreAutosaveQueue(write);
    queue.enqueue({ reps: 1 });
    queue.enqueue({ reps: 6 });
    first.resolve({ ok: true, revision: "2026-10-03T10:00:00.001Z" });
    await Promise.resolve();
    expect(queue.getSnapshot()).toMatchObject({ dirty: true, revision: "2026-10-03T10:00:00.001Z" });
    last.resolve({ ok: true, revision: "2026-10-03T10:00:00.006Z" });
    expect(await queue.flush()).toBe(true);
    const saved = queue.getSnapshot();
    expect(saved).toMatchObject({ dirty: false, revision: "2026-10-03T10:00:00.006Z" });
    expect(isCurrentScoreSnapshot("2026-10-03T10:00:00.000Z", null, saved.revision)).toBe(false);
    expect(isCurrentScoreSnapshot(null, null, saved.revision)).toBe(false);
    expect(isCurrentScoreSnapshot(saved.revision, null, saved.revision)).toBe(true);
    expect(isCurrentScoreSnapshot("2026-10-03T10:00:00.007Z", saved.revision, saved.revision)).toBe(true);
    queue.enqueue({ reps: 5 });
    expect(write).toHaveBeenLastCalledWith({ reps: 5 });
  });

  it("keeps the acknowledged revision through a failure and never moves it backwards", async () => {
    const write = vi.fn()
      .mockResolvedValueOnce({ ok: true, revision: "2026-10-03T10:00:00.006Z" })
      .mockResolvedValueOnce({ ok: false, error: "INVALID_SCORE" })
      .mockResolvedValueOnce({ ok: true, revision: "2026-10-03T10:00:00.005Z" });
    const queue = createScoreAutosaveQueue(write);
    queue.enqueue({ reps: 6 });
    expect(await queue.flush()).toBe(true);
    queue.enqueue({ metres: -1 });
    await Promise.resolve();
    expect(queue.getSnapshot()).toMatchObject({ dirty: true, error: "INVALID_SCORE", revision: "2026-10-03T10:00:00.006Z" });
    queue.enqueue({ metres: 1 });
    expect(await queue.flush()).toBe(true);
    expect(queue.getSnapshot().revision).toBe("2026-10-03T10:00:00.006Z");
  });

  it("accepts another operator's newer revision but rejects an older poll arriving afterwards", () => {
    const ownSave = "2026-10-03T10:00:00.006Z";
    const otherSave = "2026-10-03T10:00:00.007Z";
    expect(isCurrentScoreSnapshot(otherSave, ownSave, ownSave)).toBe(true);
    expect(isCurrentScoreSnapshot(ownSave, otherSave, ownSave)).toBe(false);
    expect(isCurrentScoreSnapshot(otherSave, otherSave, ownSave)).toBe(true);
    expect(isCurrentScoreSnapshot(undefined, undefined, undefined)).toBe(true);
  });
});
