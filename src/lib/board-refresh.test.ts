import { describe, expect, it, vi } from "vitest";

import { createBoardRefresh } from "@/lib/board-refresh";

describe("board fetch queue", () => {
  it("a change mid-fetch queues a fresh read without overlapping or losing the update", async () => {
    let resolve!: (value: number) => void;
    const load = vi.fn<() => Promise<number | null>>()
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockResolvedValue(2);
    const receive = vi.fn();
    const refresh = createBoardRefresh(load, receive);
    const first = refresh.refresh();
    await refresh.refresh();
    await refresh.refresh();
    expect(load).toHaveBeenCalledTimes(1);
    resolve(1);
    await first;
    expect(load).toHaveBeenCalledTimes(2);
    expect(receive.mock.calls).toEqual([[1], [2]]);
  });

  it("retains the old payload on failure, retries next time, and ignores unmounted results", async () => {
    const load = vi.fn<() => Promise<number | null>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(2);
    const receive = vi.fn();
    const refresh = createBoardRefresh(load, receive);
    await refresh.refresh();
    expect(receive).not.toHaveBeenCalled();
    await refresh.refresh();
    expect(receive).toHaveBeenCalledWith(2);
    const stopped = refresh.refresh();
    refresh.stop();
    await stopped;
    expect(receive).toHaveBeenCalledTimes(1);
  });
});
