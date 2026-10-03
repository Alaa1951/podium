import { afterEach, describe, expect, it, vi } from "vitest";

import { createScoreAutosaveQueue, type AutosaveResult } from "@/lib/score-autosave";

const deferred = () => {
  let resolve!: (result: AutosaveResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AutosaveResult>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
afterEach(() => { vi.useRealTimers(); });

describe("live score autosave", () => {
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
    expect(queue.getSnapshot()).toEqual({ dirty: false, saving: false, saved: true, error: null });
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
});
