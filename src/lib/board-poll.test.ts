import { beforeEach, describe, expect, it, vi } from "vitest";

const build = vi.hoisted(() => vi.fn());
vi.mock("@/lib/board", () => ({ buildBoardPayload: build }));

import { notifyBoardChanged } from "@/lib/board-events";
import { sharedBoardPayload } from "@/lib/board-poll";

describe("shared board payload", () => {
  beforeEach(() => { build.mockReset(); });

  it("shares ordinary polls, but a committed write invalidates both ID and slug immediately", async () => {
    build.mockResolvedValue({ seriesId: "poll-series", value: 1 });
    await sharedBoardPayload("poll-series");
    await sharedBoardPayload("poll-series-slug");
    await sharedBoardPayload("poll-series");
    expect(build).toHaveBeenCalledTimes(2);
    notifyBoardChanged("poll-series");
    build.mockResolvedValue({ seriesId: "poll-series", value: 2 });
    expect(await sharedBoardPayload("poll-series")).toMatchObject({ value: 2 });
    expect(await sharedBoardPayload("poll-series-slug")).toMatchObject({ value: 2 });
    expect(build).toHaveBeenCalledTimes(4);
  });

  it("re-reads a build overtaken by a committed write", async () => {
    let resolve!: (value: unknown) => void;
    build.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const payload = sharedBoardPayload("poll-in-flight");
    notifyBoardChanged("poll-in-flight");
    build.mockResolvedValue({ seriesId: "poll-in-flight", value: 2 });
    resolve({ seriesId: "poll-in-flight", value: 1 });
    expect(await payload).toMatchObject({ value: 2 });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("continuous counter changes cannot keep a payload build running forever", async () => {
    build.mockImplementation(async () => {
      notifyBoardChanged("poll-continuous");
      return { seriesId: "poll-continuous", value: build.mock.calls.length };
    });
    expect(await sharedBoardPayload("poll-continuous")).toMatchObject({ value: 2 });
    expect(build).toHaveBeenCalledTimes(2);
  });
});
