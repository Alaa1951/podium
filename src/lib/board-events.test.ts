import { describe, expect, it, vi } from "vitest";

import { boardCacheEpoch, boardRevision, notifyBoardChanged, subscribeBoardChanges } from "@/lib/board-events";
import { boardEventResponse } from "@/lib/board-stream";

describe("board change notifications", () => {
  it("invalidates cached aliases and notifies only the changed series after a write", () => {
    const changed = vi.fn();
    const other = vi.fn();
    const off = subscribeBoardChanges("events-one", changed);
    const offOther = subscribeBoardChanges("events-two", other);
    const epoch = boardCacheEpoch();
    const revision = boardRevision("events-one");
    notifyBoardChanged("events-one");
    expect(boardCacheEpoch()).toBe(epoch + 1);
    expect(changed).toHaveBeenCalledWith(revision + 1);
    expect(other).not.toHaveBeenCalled();
    off();
    offOther();
    notifyBoardChanged("events-one");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("a closed subscriber cannot make a committed write fail", () => {
    const off = subscribeBoardChanges("events-disconnected", () => { throw new Error("closed"); });
    expect(() => notifyBoardChanged("events-disconnected")).not.toThrow();
    off();
  });

  it("streams only numeric revisions and closes on request cancellation", async () => {
    const abort = new AbortController();
    const response = boardEventResponse(new Request("http://localhost/events", { signal: abort.signal }), "events-stream");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe("retry: 1000\n\n");
    expect(decoder.decode((await reader.read()).value)).toBe("event: board\ndata: 0\n\n");
    notifyBoardChanged("events-stream");
    expect(decoder.decode((await reader.read()).value)).toBe("event: board\ndata: 1\n\n");
    abort.abort();
    expect((await reader.read()).done).toBe(true);
  });

  it("reader cancellation cleans up a stream without throwing", async () => {
    const response = boardEventResponse(new Request("http://localhost/events"), "events-reader-cancelled");
    const reader = response.body!.getReader();
    await expect(reader.cancel()).resolves.toBeUndefined();
    expect(() => notifyBoardChanged("events-reader-cancelled")).not.toThrow();
  });
});
